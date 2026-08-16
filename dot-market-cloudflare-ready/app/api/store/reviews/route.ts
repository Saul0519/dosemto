import { currentUser } from "../../../../db/discord-session";
import { deleteReview, saveReview } from "../../../../db/store-reviews";
import { slowDown, tooMany } from "../../../../db/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (await tooMany(request, "review")) return slowDown();

  const author = await currentUser(request).catch(() => null);
  if (!author) return Response.json({ error: "디스코드로 로그인해 주세요." }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });

  // saveReview owns the rules: whose purchase it is, whether it has been handed
  // over yet, and what a rating may be.
  const result = await saveReview({
    orderNo: String(body.orderNo ?? "").trim().toUpperCase(),
    authorId: author.id,
    authorName: author.name,
    rating: Number(body.rating) || 0,
    body: String(body.body ?? ""),
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const author = await currentUser(request).catch(() => null);
  if (!author) return Response.json({ error: "디스코드로 로그인해 주세요." }, { status: 401 });

  const orderNo = new URL(request.url).searchParams.get("orderNo") ?? "";
  const result = await deleteReview(orderNo.trim().toUpperCase(), author.id);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true });
}
