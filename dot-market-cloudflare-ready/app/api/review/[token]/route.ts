import { currentUser } from "../../../../db/discord-session";
import { submitReview } from "../../../../db/reviews";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  // The name on a review is the Discord account that wrote it, so the session
  // supplies it — a client-sent name could impersonate anyone.
  const author = await currentUser(request).catch(() => null);
  if (!author) {
    return Response.json(
      { error: "디스코드로 로그인한 뒤 후기를 남길 수 있습니다." },
      { status: 401 },
    );
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
    const result = await submitReview(token, {
      rating,
      body: String(body.body ?? ""),
      player: { uuid: author.id, name: author.name },
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json({ ok: true, shopSlug: result.shopSlug });
  } catch {
    return Response.json({ error: "후기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
}
