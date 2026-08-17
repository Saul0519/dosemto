import { getChatGPTUser } from "../../../../../chatgpt-auth";
import { deletePurchase, isPurchaseStatus, listPurchases, setPurchaseStatus } from "../../../../../../db/store";
import { isSuperAdmin } from "../../../../../../db/shops";
import { sendDirectMessage } from "../../../../../../db/discord-bot";

export const dynamic = "force-dynamic";

async function denied() {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = await denied();
  if (blocked) return blocked;
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { status?: unknown } | null;
  if (!isPurchaseStatus(body?.status)) {
    return Response.json({ error: "그런 상태는 없습니다." }, { status: 400 });
  }
  if (!(await setPurchaseStatus(id, body.status))) {
    return Response.json({ error: "그 요청을 찾지 못했습니다." }, { status: 404 });
  }

  const purchases = await listPurchases();

  // Refusing from Discord tells the buyer; refusing from here has to as well, or
  // the same act means two different things depending on where it was done.
  if (body.status === "rejected") {
    const purchase = purchases.find((row) => row.id === id);
    if (purchase) {
      await sendDirectMessage(purchase.buyerId, {
        content: `**${purchase.itemName}** 구매 요청이 거절되었습니다.`,
        embeds: [{
          title: `주문 ${purchase.orderNo}`,
          color: 0xb3261e,
          description: `${purchase.planLabel}\n\n`
            + "이 요청은 닫혔습니다. 다시 신청하실 수 있습니다.",
        }],
      }).catch(() => undefined);
    }
  }

  return Response.json({ ok: true, purchases });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = await denied();
  if (blocked) return blocked;
  const { id } = await context.params;
  if (!(await deletePurchase(id))) {
    return Response.json({ error: "그 요청을 찾지 못했습니다." }, { status: 404 });
  }
  return Response.json({ ok: true, purchases: await listPurchases() });
}
