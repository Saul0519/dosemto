import { getChatGPTUser } from "../../../../chatgpt-auth";
import { deleteApplication, listApplications, setApplicationHandled } from "../../../../../db/applications";
import { isSuperAdmin } from "../../../../../db/shops";

export const dynamic = "force-dynamic";

async function requireOwner() {
  const user = await getChatGPTUser();
  if (!user) return { error: "관리자 로그인이 필요합니다.", status: 401 as const };
  if (!(await isSuperAdmin(user.email))) {
    return { error: "총괄 관리자만 할 수 있습니다.", status: 403 as const };
  }
  return null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return Response.json({ error: denied.error }, { status: denied.status });

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { handled?: boolean } | null;
  if (!body) return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });

  const result = await setApplicationHandled(id, body.handled === true);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, applications: await listApplications() });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return Response.json({ error: denied.error }, { status: denied.status });

  const { id } = await context.params;
  const result = await deleteApplication(id);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, applications: await listApplications() });
}
