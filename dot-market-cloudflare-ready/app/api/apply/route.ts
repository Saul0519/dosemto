import { currentUser } from "../../../db/discord-session";
import { submitApplication } from "../../../db/applications";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Signed in, so the owner has an account to reply to and the form cannot be
  // filled in by a passer-by.
  const applicant = await currentUser(request).catch(() => null);
  if (!applicant) {
    return Response.json({ error: "디스코드로 로그인한 뒤 신청할 수 있습니다." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }

  try {
    const result = await submitApplication({
      applicantId: applicant.id,
      applicantName: applicant.name,
      mcNick: String(body.mcNick ?? ""),
      affiliation: String(body.affiliation ?? ""),
      job: String(body.job ?? ""),
      shopName: String(body.shopName ?? ""),
      wantedSlug: String(body.wantedSlug ?? ""),
      intro: String(body.intro ?? ""),
      note: String(body.note ?? ""),
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "신청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
}
