import { currentUser } from "../../../db/discord-session";
import { submitApplication } from "../../../db/applications";
import { sendDirectMessage } from "../../../db/discord-bot";

import { slowDown, tooMany } from "../../../db/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (await tooMany(request, "apply")) return slowDown();

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

  const application = {
    applicantId: applicant.id,
    applicantName: applicant.name,
    mcNick: String(body.mcNick ?? ""),
    affiliation: String(body.affiliation ?? ""),
    job: String(body.job ?? ""),
    email: String(body.email ?? ""),
    shopName: String(body.shopName ?? ""),
    wantedSlug: String(body.wantedSlug ?? ""),
    intro: String(body.intro ?? ""),
    note: String(body.note ?? ""),
  };

  try {
    const result = await submitApplication(application);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  } catch {
    return Response.json({ error: "신청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }

  // Saved already, so a failed notification is not the applicant's problem —
  // the request still shows up in the control panel either way.
  await notifyOwner(application, new URL(request.url).origin).catch(() => undefined);

  return Response.json({ ok: true });
}

type ApplicationSummary = {
  applicantName: string; applicantId: string; mcNick: string; affiliation: string;
  job: string; email: string; shopName: string; wantedSlug: string; intro: string; note: string;
};

/** A DM to the site owner, so an application does not wait to be noticed. */
async function notifyOwner(application: ApplicationSummary, origin: string) {
  const { env } = await import("cloudflare:workers");
  const ownerId = typeof env.OWNER_DISCORD_ID === "string" ? env.OWNER_DISCORD_ID.trim() : "";
  if (!ownerId) return;

  const facts = [
    `도스 닉네임 · ${application.mcNick}`,
    application.affiliation && `소속 · ${application.affiliation}`,
    application.job && `직업 · ${application.job}`,
    `이메일 · ${application.email}`,
    application.wantedSlug && `원하는 주소 · /shop/${application.wantedSlug}`,
    `디스코드 · ${application.applicantName} (${application.applicantId})`,
  ].filter(Boolean).join("\n");

  await sendDirectMessage(ownerId, {
    content: `새 입점 신청 — **${application.shopName}**\n${origin}/control`,
    embeds: [{
      title: application.shopName,
      color: 0x6654a8,
      description: [facts, application.intro, application.note]
        .filter(Boolean).join("\n\n").slice(0, 4000),
    }],
    allowed_mentions: { parse: [] },
  });
}
