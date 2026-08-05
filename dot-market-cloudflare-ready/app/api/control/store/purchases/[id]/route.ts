import { getChatGPTUser } from "../../../../../chatgpt-auth";
import { deletePurchase, listPurchases, setPurchaseHandled } from "../../../../../../db/store";
import { isSuperAdmin } from "../../../../../../db/shops";

export const dynamic = "force-dynamic";

async function denied() {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = await denied();
  if (blocked) return blocked;
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { handled?: boolean } | null;
  if (!(await setPurchaseHandled(id, body?.handled === true))) {
    return Response.json({ error: "그 요청을 찾지 못했습니다." }, { status: 404 });
  }
  return Response.json({ ok: true, purchases: await listPurchases() });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = await denied();
  if (blocked) return blocked;
  const { id } = await context.params;
  if (!(await deletePurchase(id))) {
    return Response.json({ error: "그 요청을 찾지 못했습니다." }, { status: 404 });
  }
  return Response.json({ ok: true, purchases: await listPurchases() });
}
