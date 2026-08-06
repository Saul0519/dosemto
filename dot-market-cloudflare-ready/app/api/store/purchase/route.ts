import { currentUser } from "../../../../db/discord-session";
import {
  StorePurchase, getItem, getStoreChannelId, getStoreGuildId, recordPurchase, setPurchaseRoles,
} from "../../../../db/store";
import { renderMarkdown } from "../../../../db/markdown";
import { rolesForMember } from "../../../../db/discord-roles";
import { won } from "../../../../db/store-plans";
import { botToken } from "../../../../db/discord-bot";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Signed in, so the owner has someone to hand the goods to and nobody can
  // place a request under another player's name.
  const buyer = await currentUser(request).catch(() => null);
  if (!buyer) {
    return Response.json({ error: "디스코드로 로그인한 뒤 구매할 수 있습니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });

  let result: Awaited<ReturnType<typeof recordPurchase>>;
  try {
    // The price comes from the stored item, never from the browser.
    result = await recordPurchase({
      itemId: String(body.itemId ?? ""),
      planLabel: String(body.planLabel ?? ""),
      mcNick: String(body.mcNick ?? ""),
      note: String(body.note ?? ""),
      buyerId: buyer.id,
      buyerName: buyer.name,
    });
  } catch {
    return Response.json({ error: "구매 요청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  // Roles are looked up after the row exists, so a slow or unreachable Discord
  // costs the record nothing. Off unless a server is set.
  const guildId = await getStoreGuildId().catch(() => "");
  if (guildId) {
    const roles = await rolesForMember(guildId, buyer.id).catch(() => null);
    if (roles && roles.length > 0) {
      result.purchase.roles = roles;
      await setPurchaseRoles(result.purchase.id, roles).catch(() => undefined);
    }
  }

  // Recorded already, so a Discord problem is not the buyer's problem — the
  // request is in the control panel either way.
  await notify(result.purchase).catch(() => undefined);

  const item = await getItem(result.purchase.itemId).catch(() => null);
  const licence = item?.licence?.trim() ?? "";
  return Response.json({
    ok: true,
    orderNo: result.purchase.orderNo,
    // Rendered here so the browser is handed finished markup rather than a
    // renderer, and the notice reads the same wherever it is shown.
    licence: licence ? renderMarkdown(licence) : "",
  });
}

async function notify(purchase: StorePurchase) {
  const channelId = await getStoreChannelId();
  const token = await botToken();
  if (!channelId || !token) return;

  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
      "user-agent": "DotMarket (https://dosemto.store, 1.0)",
    },
    body: JSON.stringify({
      content: `🛒 **${purchase.itemName}** · ${purchase.planLabel} 구매 요청`,
      allowed_mentions: { parse: [] },
      embeds: [{
        color: 0x4a7439,
        fields: [
          { name: "주문번호", value: purchase.orderNo, inline: true },
          { name: "도스 닉네임", value: purchase.mcNick, inline: true },
          { name: "금액", value: won(purchase.price), inline: true },
          { name: "기간", value: purchase.planLabel, inline: true },
          { name: "디스코드", value: `${purchase.buyerName} (<@${purchase.buyerId}>)`, inline: false },
          ...(purchase.roles.length > 0
            ? [{ name: "역할", value: purchase.roles.join(", ").slice(0, 1000), inline: false }]
            : []),
          ...(purchase.note ? [{ name: "남긴 말", value: purchase.note, inline: false }] : []),
        ],
        timestamp: purchase.createdAt,
      }],
      // Pressing this marks the purchase handed over and sends the buyer their
      // review link, so the whole handover happens without opening the site.
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 3,
          label: "전달 완료",
          custom_id: `storedone:${purchase.id}`,
          emoji: { name: "📦" },
        }],
      }],
    }),
  });
}
