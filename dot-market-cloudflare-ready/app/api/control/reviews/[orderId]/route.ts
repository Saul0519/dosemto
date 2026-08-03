import { getChatGPTUser } from "../../../../chatgpt-auth";
import { isSuperAdmin } from "../../../../../db/shops";
import { purgeReview, setReviewHidden } from "../../../../../db/reviews";

export const dynamic = "force-dynamic";

async function requireOwner() {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) return null;
  return user;
}

/** Hides or unhides a review. Reversible, and the count stays public. */
export async function PATCH(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!(await requireOwner())) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const { orderId } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }
  if (typeof body.hidden !== "boolean") {
    return Response.json({ error: "숨김 여부를 지정해 주세요." }, { status: 400 });
  }

  const result = await setReviewHidden(orderId, body.hidden).catch(() => null);
  if (!result) return Response.json({ error: "처리하지 못했습니다." }, { status: 503 });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, hidden: body.hidden });
}

/** Removes a review outright. For content that cannot merely be hidden. */
export async function DELETE(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!(await requireOwner())) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const { orderId } = await context.params;
  const result = await purgeReview(orderId).catch(() => null);
  if (!result) return Response.json({ error: "처리하지 못했습니다." }, { status: 503 });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true });
}
