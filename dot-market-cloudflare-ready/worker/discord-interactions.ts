/**
 * Handles the buttons on an order notification.
 *
 * Lives in the worker entry rather than the app router because Discord expects
 * a reply within three seconds and disables an endpoint that fails signature
 * checks. Both are easier to guarantee before the framework gets involved.
 */

type Env = {
  DB: D1Database;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_BOT_TOKEN?: string;
};

type Ctx = { waitUntil(promise: Promise<unknown>): void };

const PONG = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;

/** Reply types: 4 posts a new message, 6 acknowledges and edits later. */
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const DEFERRED_UPDATE_MESSAGE = 6;

const EPHEMERAL = 1 << 6;

const hexToBytes = (hex: string) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

async function verify(request: Request, body: string, publicKeyHex: string) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp || !publicKeyHex) return false;
  for (const algorithm of ["Ed25519", "NODE-ED25519"]) {
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
      // try the other spelling
    }
  }
  return false;
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

const ephemeral = (content: string) =>
  json({ type: CHANNEL_MESSAGE_WITH_SOURCE, data: { content, flags: EPHEMERAL } });

export async function handleInteraction(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const body = await request.text();
  if (!await verify(request, body, env.DISCORD_PUBLIC_KEY ?? "")) {
    return new Response("bad signature", { status: 401 });
  }

  const interaction = JSON.parse(body) as {
    type: number;
    data?: { custom_id?: string };
    message?: { id?: string };
    channel_id?: string;
    member?: { user?: { id?: string } };
    user?: { id?: string };
  };

  if (interaction.type === PONG) return json({ type: PONG });
  if (interaction.type === APPLICATION_COMMAND) {
    return ephemeral("이 봇은 주문 알림의 버튼으로만 동작합니다.");
  }
  if (interaction.type !== MESSAGE_COMPONENT) return json({ type: PONG });

  const customId = interaction.data?.custom_id ?? "";
  const [action, orderId] = customId.split(":");
  if (!orderId || !["accept", "reject", "complete"].includes(action)) {
    return ephemeral("알 수 없는 버튼입니다.");
  }

  // Acknowledge first, then do the work — the three-second budget is for this
  // reply, and a D1 write plus two Discord calls will not always fit inside it.
  ctx.waitUntil(applyAction({
    env,
    action: action as "accept" | "reject" | "complete",
    orderId,
    channelId: interaction.channel_id ?? "",
    messageId: interaction.message?.id ?? "",
    actorId: interaction.member?.user?.id ?? interaction.user?.id ?? "",
    origin: new URL(request.url).origin,
  }));

  return json({ type: DEFERRED_UPDATE_MESSAGE });
}

const STATUS_FOR = { accept: "working", reject: "cancelled", complete: "completed" } as const;
const MARK = { accept: "🛠️", reject: "🚫", complete: "✅" } as const;
const LABEL = { accept: "수락", reject: "거절", complete: "완성" } as const;

async function applyAction(input: {
  env: Env;
  action: "accept" | "reject" | "complete";
  orderId: string;
  channelId: string;
  messageId: string;
  actorId: string;
  origin: string;
}) {
  const { env, action, orderId, channelId, messageId, origin } = input;
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!env.DB || !token) return;

  const order = await env.DB.prepare(
    `SELECT o.id, o.status, o.player_uuid, o.player_name, o.tile_count, o.deadline,
            o.total_price, s.name AS shop_name, s.slug AS shop_slug
       FROM orders o JOIN shops s ON s.id = o.shop_id WHERE o.id = ?`,
  ).bind(orderId).first<{
    id: string; status: string; player_uuid: string | null; player_name: string | null;
    tile_count: number; deadline: number; total_price: number;
    shop_name: string; shop_slug: string;
  }>().catch(() => null);
  if (!order) return;

  const status = STATUS_FOR[action];

  // Conditional update: a second press finds nothing to change and stops here,
  // so nobody gets two DMs for one click.
  const updated = await env.DB.prepare(
    "UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != ?",
  ).bind(status, orderId, status).run().catch(() => null);
  if (!updated?.meta.changes) return;

  const api = "https://discord.com/api/v10";
  const headers = {
    authorization: `Bot ${token}`,
    "content-type": "application/json",
    "user-agent": "DotMarket (https://dosemto.store, 1.0)",
  };

  // Strip the buttons off the handled message so it cannot be pressed again.
  if (channelId && messageId) {
    await fetch(`${api}/channels/${channelId}/messages/${messageId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        content: `${MARK[action]} **${orderId}** · ${LABEL[action]} 처리됨`,
        components: [],
      }),
    }).catch(() => undefined);
  }

  const won = `${order.total_price.toLocaleString("ko-KR")}원`;
  let dm: Record<string, unknown> | null = null;

  if (action === "accept") {
    dm = {
      content: `**${order.shop_name}**에서 주문을 수락했습니다.`,
      embeds: [{
        title: `주문 ${orderId}`,
        color: 0x4a7439,
        description: `캔버스 ${order.tile_count}장 · 마감 ${order.deadline}일 · ${won}\n작업이 끝나면 다시 알려드립니다.`,
      }],
    };
    // A fresh message so the finish button is separate from the handled one.
    if (channelId) {
      await fetch(`${api}/channels/${channelId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: `🛠️ **${orderId}** 작업 중 · 다 그리면 아래 버튼을 눌러주세요.`,
          allowed_mentions: { parse: [] },
          components: [{
            type: 1,
            components: [{
              type: 2,
              style: 3,
              label: "그림 완성",
              custom_id: `complete:${orderId}`,
              emoji: { name: "🎨" },
            }],
          }],
        }),
      }).catch(() => undefined);
    }
  }

  if (action === "reject") {
    dm = {
      content: `**${order.shop_name}**에서 주문을 거절했습니다.`,
      embeds: [{
        title: `주문 ${orderId}`,
        color: 0xb3261e,
        description: "사유가 궁금하시면 샵에 직접 문의해 주세요. 다른 샵에 다시 주문하실 수 있습니다.",
      }],
    };
  }

  if (action === "complete") {
    // The review page is keyed on the order number and checks ownership, so no
    // one-shot token is needed any more.
    const reviewUrl = `${origin}/review/${orderId}`;
    dm = {
      content: `**${order.shop_name}**에서 그림을 완성했습니다. 게임에서 받아가세요.`,
      embeds: [{
        title: `주문 ${orderId}`,
        color: 0x6654a8,
        description: reviewUrl
          ? `수령 방법은 샵에 문의해 주세요.\n\n작업이 어떠셨는지 남겨주시면 다음 주문하는 분께 도움이 됩니다.\n${reviewUrl}`
          : "수령 방법은 샵에 문의해 주세요.",
      }],
    };
  }

  if (!dm || !order.player_uuid) return;

  const sent = await sendDm(api, headers, order.player_uuid, dm);
  if (!sent && channelId) {
    // DMs fail when the customer blocks them or shares no server with the bot.
    // Falling back to a mention keeps the message reachable either way.
    await fetch(`${api}/channels/${channelId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: `<@${order.player_uuid}> ${dm.content as string}\n(DM이 막혀 있어 여기로 보냅니다.)`,
        allowed_mentions: { users: [order.player_uuid] },
        embeds: dm.embeds,
      }),
    }).catch(() => undefined);
  }
}

async function sendDm(
  api: string,
  headers: Record<string, string>,
  userId: string,
  payload: Record<string, unknown>,
) {
  const channel = await fetch(`${api}/users/@me/channels`, {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient_id: userId }),
  }).catch(() => null);
  if (!channel?.ok) return false;
  const dm = await channel.json().catch(() => null) as { id?: string } | null;
  if (!dm?.id) return false;
  const sent = await fetch(`${api}/channels/${dm.id}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }).catch(() => null);
  return Boolean(sent?.ok);
}
