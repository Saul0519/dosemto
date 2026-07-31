import { getChatGPTUser } from "../../../../chatgpt-auth";
import { ORDER_STATUSES, OrderStatus, updateOrderStatus } from "../../../../../db/orders";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "ChatGPT 로그인이 필요합니다." }, { status: 401 });

  const { id } = await context.params;
  const body = await request.json() as { status?: unknown };
  const status = String(body.status ?? "") as OrderStatus;
  if (!ORDER_STATUSES.includes(status) || status === "notification_failed") {
    return Response.json({ error: "주문 상태를 확인해 주세요." }, { status: 400 });
  }

  const order = await updateOrderStatus(id, user.email, status);
  if (!order) return Response.json({ error: "이 주문을 관리할 권한이 없습니다." }, { status: 403 });
  return Response.json({ ok: true, order });
}

