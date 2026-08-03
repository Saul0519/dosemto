import { getChatGPTUser } from "../../../../chatgpt-auth";
import { isSuperAdmin } from "../../../../../db/shops";
import { deleteOrderCascade } from "../../../../../db/orders";

export const dynamic = "force-dynamic";

/**
 * Deletes one order with its review, action links and stored files. Owner only:
 * a shop being able to erase an order would take its review with it.
 */
export async function DELETE(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 주문을 삭제할 수 있습니다." }, { status: 403 });
  }

  const { orderId } = await context.params;
  // Typing the order number is the guard against a misclick; none of this comes back.
  if ((new URL(request.url).searchParams.get("confirm") ?? "") !== orderId) {
    return Response.json({ error: `삭제하려면 주문번호 "${orderId}"를 정확히 입력해 주세요.` }, { status: 400 });
  }

  const removed = await deleteOrderCascade(orderId).catch(() => null);
  if (!removed) return Response.json({ error: "이미 없는 주문입니다." }, { status: 404 });

  // Rows are gone either way; a failed purge only leaves unreferenced blobs.
  const { env } = await import("cloudflare:workers");
  let purged = 0;
  if (env.BUCKET) {
    for (const key of removed.objectKeys) {
      try {
        await env.BUCKET.delete(key);
        purged += 1;
      } catch {
        // leave it
      }
    }
  }

  return Response.json({ ok: true, orderId, filesPurged: purged, filesTotal: removed.objectKeys.length });
}
