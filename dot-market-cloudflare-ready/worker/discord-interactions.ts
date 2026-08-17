/**
 * Handles the buttons on an order notification.
 *
 * Lives in the worker entry rather than the app router because Discord expects
 * a reply within three seconds and disables an endpoint that fails signature
 * checks. Both are easier to guarantee before the framework gets involved.
 */

import { deadlineLabel } from "../db/deadlines";

type Env = {
  DB: D1Database;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_BOT_TOKEN?: string;
  OWNER_DISCORD_ID?: string;
};

/**
 * Discord works out what the presser may do and sends it with the interaction,
 * so there is nothing to look up and nothing to keep in step.
 *
 * Either bit means "runs this server". Inviting the bot needs MANAGE_GUILD in
 * the first place, so a shop's own manager always has one of them.
 */
// Written with the constructor rather than the `n` suffix: the build targets a
// version that has BigInt but not its literal syntax.
const ADMINISTRATOR = BigInt(8);
const MANAGE_GUILD = BigInt(32);
const NONE = BigInt(0);

function runsTheServer(permissions: string | undefined) {
  if (!permissions) return false;
  try {
    // The bitfield outgrows a plain number, so it arrives as a decimal string.
    const held = BigInt(permissions);
    return (held & ADMINISTRATOR) !== NONE || (held & MANAGE_GUILD) !== NONE;
  } catch {
    return false;
  }
}

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
    member?: { user?: { id?: string }; permissions?: string };
    user?: { id?: string };
  };

  const actorId = interaction.member?.user?.id ?? interaction.user?.id ?? "";
  const owner = (env.OWNER_DISCORD_ID ?? "").trim();
  // Seeing the button is not the same as being allowed to press it. Everyone in
  // the channel can see it.
  const allowed = (owner !== "" && actorId === owner)
    || runsTheServer(interaction.member?.permissions);

  if (interaction.type === PONG) return json({ type: PONG });
  if (interaction.type === APPLICATION_COMMAND) {
    return ephemeral("이 봇은 주문 알림의 버튼으로만 동작합니다.");
  }
  if (interaction.type !== MESSAGE_COMPONENT) return json({ type: PONG });

  const customId = interaction.data?.custom_id ?? "";
  const [action, orderId] = customId.split(":");
  if (!orderId) return ephemeral("알 수 없는 버튼입니다.");

  if (!allowed) {
    return ephemeral("이 버튼은 샵 관리자만 누를 수 있습니다.");
  }

  // Store purchases live in their own tables with their own flow, so they get a
  // handler of their own rather than another branch inside the order one.
  if (action === "storedone" || action === "storereject") {
    ctx.waitUntil((action === "storedone" ? handStoreItemOver : refuseStoreRequest)({
      env,
      purchaseId: orderId,
      channelId: interaction.channel_id ?? "",
      messageId: interaction.message?.id ?? "",
      origin: new URL(request.url).origin,
    }));
    return json({ type: DEFERRED_UPDATE_MESSAGE });
  }

  if (!["accept", "reject", "complete"].includes(action)) {
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
  origin: string;
}) {
  const { env, action, orderId, channelId, messageId, origin } = input;
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!env.DB || !token) return;

  const order = await env.DB.prepare(
    `SELECT o.id, o.status, o.player_uuid, o.player_name, o.tile_count, o.deadline,
            o.total_price, s.name AS shop_name, s.slug AS shop_slug,
            s.channel_id, s.accept_channel_id, s.reject_channel_id, s.complete_channel_id
       FROM orders o JOIN shops s ON s.id = o.shop_id WHERE o.id = ?`,
  ).bind(orderId).first<{
    id: string; status: string; player_uuid: string | null; player_name: string | null;
    tile_count: number; deadline: number; total_price: number;
    shop_name: string; shop_slug: string;
    channel_id: string | null; accept_channel_id: string | null;
    reject_channel_id: string | null; complete_channel_id: string | null;
  }>().catch(() => null);
  if (!order) return;

  const status = STATUS_FOR[action];

  // Each outcome can have its own channel. Unset falls back to the order
  // channel, and that in turn to wherever the button was pressed — so this
  // still works for a shop that never opened the setting.
  const outcomeChannel = (action === "accept" ? order.accept_channel_id
    : action === "reject" ? order.reject_channel_id
    : order.complete_channel_id) || order.channel_id || channelId;

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
  // Set when a branch already posted its own message to the outcome channel.
  let postedRecord = false;

  if (action === "accept") {
    dm = {
      content: `**${order.shop_name}**에서 주문을 수락했습니다.`,
      embeds: [{
        title: `주문 ${orderId}`,
        color: 0x4a7439,
        description: `캔버스 ${order.tile_count}장 · ${deadlineLabel(order.deadline)} · ${won}\n작업이 끝나면 다시 알려드립니다.`,
      }],
    };
    // A fresh message so the finish button is separate from the handled one.
    // This doubles as the accepted-orders record, so nothing else is posted.
    postedRecord = true;
    if (outcomeChannel) {
      await fetch(`${api}/channels/${outcomeChannel}/messages`, {
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

  if (!dm) return;

  // A bot can only DM someone it shares a server with, and only if they allow
  // it — most customers are neither. /me is what everyone can rely on.
  const sent = order.player_uuid
    ? await sendDm(api, headers, order.player_uuid, dm)
    : false;

  // Keep the outcome channel a record of what happened rather than a place
  // failed DMs land in. Skipped when the accepted-order message already says
  // it, or when this is the very channel whose message was just edited to.
  const needsRecord = Boolean(outcomeChannel) && !postedRecord
    && (outcomeChannel !== channelId || !sent);

  if (needsRecord) {
    const reachedCustomer = sent || !order.player_uuid;
    await fetch(`${api}/channels/${outcomeChannel}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: reachedCustomer
          ? `${MARK[action]} **${orderId}** · ${LABEL[action]} 처리됨`
          : `<@${order.player_uuid}> ${dm.content as string}\n`
            + "(DM이 닿지 않아 여기로 보냅니다. 주문자는 사이트 \"내 주문\"에서도 확인할 수 있습니다.)",
        allowed_mentions: reachedCustomer ? { parse: [] } : { users: [order.player_uuid] },
        embeds: dm.embeds,
      }),
    }).catch(() => undefined);
  }
}

/**
 * Refuses a store request and tells the buyer, so they are free to ask again.
 *
 * Only a request still waiting can be refused — something already handed over
 * is done, and pressing this twice must not send the same person two refusals.
 *
 * No reason is asked for. One is worth having, but a button cannot collect it,
 * and a refusal the buyer never hears about is worse than a bare one: they would
 * sit blocked, waiting for an answer that had already been given.
 */
async function refuseStoreRequest(input: {
  env: Env;
  purchaseId: string;
  channelId: string;
  messageId: string;
  origin: string;
}) {
  const { env, purchaseId, channelId, messageId } = input;
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!env.DB || !token) return;

  const purchase = await env.DB.prepare(
    `SELECT order_no, item_name, plan_label, buyer_id
       FROM store_purchases WHERE id = ?`,
  ).bind(purchaseId).first<{
    order_no: string | null; item_name: string; plan_label: string; buyer_id: string;
  }>().catch(() => null);
  if (!purchase) return;

  const updated = await env.DB.prepare(
    "UPDATE store_purchases SET status = 'rejected' WHERE id = ? AND status = 'new'",
  ).bind(purchaseId).run().catch(() => null);
  if (!updated?.meta.changes) return;

  const api = "https://discord.com/api/v10";
  const headers = {
    authorization: `Bot ${token}`,
    "content-type": "application/json",
    "user-agent": "DotMarket (https://dosemto.store, 1.0)",
  };

  const orderNo = purchase.order_no ?? purchaseId.slice(0, 8).toUpperCase();

  if (channelId && messageId) {
    await fetch(`${api}/channels/${channelId}/messages/${messageId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        content: `🚫 **${purchase.item_name}** · ${purchase.plan_label} · 거절 (${orderNo})`,
        components: [],
      }),
    }).catch(() => undefined);
  }

  const dm = {
    content: `**${purchase.item_name}** 구매 요청이 거절되었습니다.`,
    embeds: [{
      title: `주문 ${orderNo}`,
      color: 0xb3261e,
      description: `${purchase.plan_label}\n\n`
        + "이 요청은 닫혔습니다. 다시 신청하실 수 있습니다.\n"
        + "이유는 이 채널에 물어봐 주세요.",
    }],
  };

  const sent = await sendDm(api, headers, purchase.buyer_id, dm);
  if (sent || !channelId) return;

  await fetch(`${api}/channels/${channelId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: `<@${purchase.buyer_id}> ${dm.content}`,
      allowed_mentions: { users: [purchase.buyer_id] },
      embeds: dm.embeds,
    }),
  }).catch(() => undefined);
}

/**
 * Marks a store purchase handed over and sends the buyer their review link.
 *
 * The link is the only thing the buyer needs afterwards, so if the DM cannot
 * reach them it goes back to the channel the button was pressed in, addressed
 * to them — otherwise a blocked DM quietly loses the review.
 */
async function handStoreItemOver(input: {
  env: Env;
  purchaseId: string;
  channelId: string;
  messageId: string;
  origin: string;
}) {
  const { env, purchaseId, channelId, messageId, origin } = input;
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!env.DB || !token) return;

  const purchase = await env.DB.prepare(
    `SELECT order_no, item_name, plan_label, price, mc_nick, buyer_id
       FROM store_purchases WHERE id = ?`,
  ).bind(purchaseId).first<{
    order_no: string | null; item_name: string; plan_label: string;
    price: number; mc_nick: string; buyer_id: string;
  }>().catch(() => null);
  if (!purchase) return;

  // Conditional, so a second press finds nothing to change and nobody is sent
  // the same link twice.
  const updated = await env.DB.prepare(
    "UPDATE store_purchases SET status = 'handled' WHERE id = ? AND status != 'handled'",
  ).bind(purchaseId).run().catch(() => null);
  if (!updated?.meta.changes) return;

  const api = "https://discord.com/api/v10";
  const headers = {
    authorization: `Bot ${token}`,
    "content-type": "application/json",
    "user-agent": "DotMarket (https://dosemto.store, 1.0)",
  };

  const orderNo = purchase.order_no ?? purchaseId.slice(0, 8).toUpperCase();
  const reviewUrl = `${origin}/store/review/${orderNo}`;
  const won = `${purchase.price.toLocaleString("ko-KR")}원`;

  if (channelId && messageId) {
    await fetch(`${api}/channels/${channelId}/messages/${messageId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        content: `📦 **${purchase.item_name}** · ${purchase.plan_label} · 전달 완료 (${orderNo})`,
        components: [],
      }),
    }).catch(() => undefined);
  }

  const dm = {
    content: `**${purchase.item_name}** 전달이 끝났습니다.`,
    embeds: [{
      title: `주문 ${orderNo}`,
      color: 0x6654a8,
      description: `${purchase.plan_label} · ${won}\n\n`
        + `써보시고 어떠셨는지 남겨주시면 다음 사람이 고르는 데 도움이 됩니다.\n${reviewUrl}`,
    }],
  };

  const sent = await sendDm(api, headers, purchase.buyer_id, dm);
  if (sent || !channelId) return;

  await fetch(`${api}/channels/${channelId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: `<@${purchase.buyer_id}> ${dm.content}\n`
        + "(DM이 닿지 않아 여기로 보냅니다. 사이트 \"내 주문\"에서도 후기를 남기실 수 있습니다.)",
      allowed_mentions: { users: [purchase.buyer_id] },
      embeds: dm.embeds,
    }),
  }).catch(() => undefined);
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
