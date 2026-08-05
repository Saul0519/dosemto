import { getChatGPTUser } from "../../../../../chatgpt-auth";
import { listAllReviews, purgeReview, setReviewHidden } from "../../../../../../db/store-reviews";
import { isSuperAdmin } from "../../../../../../db/shops";

export const dynamic = "force-dynamic";

async function denied() {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  return null;
}

/** Hiding is reversible, which is why it is the everyday tool rather than delete. */
export async function PATCH(request: Request, context: { params: Promise<{ orderNo: string }> }) {
  const blocked = await denied();
  if (blocked) return blocked;

  const { orderNo } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const result = await setReviewHidden(orderNo, body?.hidden === true);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, reviews: await listAllReviews() });
}

export async function DELETE(_request: Request, context: { params: Promise<{ orderNo: string }> }) {
  const blocked = await denied();
  if (blocked) return blocked;

  const { orderNo } = await context.params;
  const result = await purgeReview(orderNo);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, reviews: await listAllReviews() });
}
