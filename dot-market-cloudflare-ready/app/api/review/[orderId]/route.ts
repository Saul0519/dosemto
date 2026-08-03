import { currentUser } from "../../../../db/discord-session";
import { deleteReview, saveReview } from "../../../../db/reviews";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  const author = await currentUser(request).catch(() => null);
  if (!author) {
    return Response.json({ error: "디스코드로 로그인한 뒤 후기를 남길 수 있습니다." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }

  const rating = Number(body.rating);
  if (!Number.isFinite(rating)) {
    return Response.json({ error: "별점을 골라주세요." }, { status: 400 });
  }

  try {
    // saveReview owns the ownership and status checks so every caller shares them.
    const result = await saveReview({
      orderId,
      authorId: author.id,
      authorName: author.name,
      rating,
      body: String(body.body ?? ""),
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "후기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  const author = await currentUser(request).catch(() => null);
  if (!author) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    // Scoped to the author, so a shop cannot delete a review it dislikes.
    const result = await deleteReview(orderId, author.id);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "후기를 지우지 못했습니다." }, { status: 503 });
  }
}
