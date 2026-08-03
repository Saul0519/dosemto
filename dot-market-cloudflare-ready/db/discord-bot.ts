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

export async function editMessage(channelId: string, messageId: string, patch: Record<string, unknown>) {
  const token = await botToken();
  if (!token) return false;
  const response = await call(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    token,
  });
  return response.ok;
}

export async function postToChannel(channelId: string, payload: Record<string, unknown>) {
  const token = await botToken();
  if (!token) return null;
  const response = await call(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
    token,
  });
  if (!response.ok) return null;
  return await response.json().catch(() => null) as { id?: string } | null;
}

/**
 * Sends a direct message. Fails when the recipient blocks DMs or shares no
 * server with the bot, and Discord reports both as 403 — so the caller must
 * always have somewhere else to put the message.
 */
export async function sendDirectMessage(userId: string, payload: Record<string, unknown>) {
  const token = await botToken();
  if (!token) return false;

  const channel = await call("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: userId }),
    token,
  });
  if (!channel.ok) return false;
  const dm = await channel.json().catch(() => null) as { id?: string } | null;
  if (!dm?.id) return false;

  const sent = await call(`/channels/${dm.id}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
    token,
  });
  return sent.ok;
}

/**
 * Checks the Ed25519 signature Discord puts on every interaction. If this is
 * ever wrong Discord disables the endpoint, so it must reject rather than throw.
 */
export async function verifyInteraction(request: Request, body: string, publicKeyHex: string) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp || !publicKeyHex) return false;

  const hexToBytes = (hex: string) => {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  };

  // Older workerd builds only know the NODE-ED25519 alias.
  for (const algorithm of ["Ed25519", "NODE-ED25519"] as const) {
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        hexToBytes(publicKeyHex),
        { name: algorithm, namedCurve: "Ed25519" } as unknown as AlgorithmIdentifier,
        false,
        ["verify"],
      );
      return await crypto.subtle.verify(
        { name: algorithm } as unknown as AlgorithmIdentifier,
        key,
        hexToBytes(signature),
        new TextEncoder().encode(timestamp + body),
      );
    } catch {
      // try the next spelling
    }
  }
  return false;
}
