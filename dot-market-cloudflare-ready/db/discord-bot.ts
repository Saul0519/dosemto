/**
 * Talking to Discord as the application's bot.
 *
 * A plain incoming webhook cannot carry buttons — Discord drops the components
 * silently — so order notifications are posted by the bot instead, and each
 * shop stores the channel id it wants them in rather than a webhook URL.
 */

const API = "https://discord.com/api/v10";

export type ButtonStyle = 1 | 2 | 3 | 4;

export type Button = {
  customId: string;
  label: string;
  /** 1 primary, 2 secondary, 3 success, 4 danger. */
  style: ButtonStyle;
  emoji?: string;
};

export async function botToken() {
  const { env } = await import("cloudflare:workers");
  return typeof env.DISCORD_BOT_TOKEN === "string" ? env.DISCORD_BOT_TOKEN.trim() : "";
}

function actionRow(buttons: Button[]) {
  return [{
    type: 1,
    components: buttons.map((button) => ({
      type: 2,
      style: button.style,
      label: button.label,
      custom_id: button.customId,
      ...(button.emoji ? { emoji: { name: button.emoji } } : {}),
    })),
  }];
}

async function call(path: string, init: RequestInit & { token: string }) {
  const { token, ...rest } = init;
  const response = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      authorization: `Bot ${token}`,
      "user-agent": "DotMarket (https://dosemto.store, 1.0)",
      ...(rest.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(rest.headers as Record<string, string> | undefined),
    },
  });
  return response;
}

/** Text (0) and announcement (5) are the only kinds the bot can post in. */
const POSTABLE = new Set([0, 5]);

/**
 * The channels of one server the bot could post in, in the server's own order.
 *
 * The channel picker offers exactly this list and saving accepts exactly this
 * list, so a manager can never be shown a channel that will then be refused.
 *
 * Returns null when the answer is unknown — no token, bot not in the server,
 * Discord unreachable. That is not the same as an empty list, and callers must
 * not treat it as one: not knowing whose channel this is is not permission to
 * store it.
 */
export async function guildChannels(guildId: string) {
  if (!/^\d{17,20}$/.test(guildId)) return null;
  const token = await botToken();
  if (!token) return null;

  const response = await call(`/guilds/${guildId}/channels`, { token }).catch(() => null);
  if (!response?.ok) return null;

  const all = await response.json().catch(() => null) as
    { id: string; name: string; type: number; position?: number }[] | null;
  if (!Array.isArray(all)) return null;

  return all
    .filter((channel) => POSTABLE.has(channel.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((channel) => ({ id: channel.id, name: channel.name }));
}

/** Posts the order notification with its buttons. Returns the message id. */
export async function postOrderMessage(input: {
  channelId: string;
  content: string;
  embed: Record<string, unknown>;
  buttons: Button[];
  files: { name: string; blob: Blob }[];
}) {
  const token = await botToken();
  if (!token) return { ok: false as const, error: "봇 토큰이 설정되지 않았습니다." };

  const form = new FormData();
  form.append("payload_json", JSON.stringify({
    content: input.content,
    allowed_mentions: { parse: [] },
    embeds: [input.embed],
    components: actionRow(input.buttons),
  }));
  input.files.forEach((file, index) => form.append(`files[${index}]`, file.blob, file.name));

  const response = await call(`/channels/${input.channelId}/messages`, {
    method: "POST",
    body: form,
    token,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { code?: number; message?: string } | null;
    // 50001 missing access, 10003 unknown channel, 50013 missing permissions —
    // all mean the same thing to the operator: the bot cannot post there.
    const hint = detail?.code === 50001 || detail?.code === 50013
      ? "봇이 해당 채널에 글을 쓸 권한이 없습니다."
      : detail?.code === 10003
        ? "채널 ID를 찾을 수 없습니다. 다시 확인해 주세요."
        : detail?.message ?? "디스코드에 알림을 보내지 못했습니다.";
    return { ok: false as const, error: hint, code: detail?.code };
  }

  const message = await response.json().catch(() => null) as { id?: string } | null;
  return { ok: true as const, messageId: message?.id ?? null };
}

/**
 * Sends a direct message to one Discord account.
 *
 * Opening a DM channel is its own call; Discord has no "message this user"
 * endpoint. Returns false rather than throwing — every caller so far treats a
 * failed notification as something to shrug at, not something to fail on.
 */
export async function sendDirectMessage(userId: string, payload: Record<string, unknown>) {
  const token = await botToken();
  if (!token || !userId) return false;

  const headers = {
    authorization: `Bot ${token}`,
    "content-type": "application/json",
    "user-agent": "DotMarket (https://dosemto.store, 1.0)",
  };

  const channel = await fetch(`${API}/users/@me/channels`, {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient_id: userId }),
  }).catch(() => null);
  if (!channel?.ok) return false;

  const dm = await channel.json().catch(() => null) as { id?: string } | null;
  if (!dm?.id) return false;

  const sent = await fetch(`${API}/channels/${dm.id}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }).catch(() => null);
  return Boolean(sent?.ok);
}
