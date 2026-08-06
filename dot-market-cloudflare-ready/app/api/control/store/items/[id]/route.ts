import { getChatGPTUser } from "../../../../../chatgpt-auth";
import { deleteItem, listAllItems, updateItem } from "../../../../../../db/store";
import { StorePlan } from "../../../../../../db/store-plans";
import { isSuperAdmin } from "../../../../../../db/shops";

export const dynamic = "force-dynamic";

async function denied() {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  return null;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = await denied();
  if (blocked) return blocked;

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });

  // updateItem normalises the plans, so a blank label, a "discount" that costs
  // more than the original, or a colour that is not a colour never reaches the
  // page.
  await updateItem(id, {
    name: String(body.name ?? ""),
    description: String(body.description ?? ""),
    detail: String(body.detail ?? ""),
    licence: String(body.licence ?? ""),
    tagline: String(body.tagline ?? ""),
    plans: Array.isArray(body.plans) ? body.plans as StorePlan[] : [],
    active: body.active === true,
    position: Number(body.position) || 0,
  });
  return Response.json({ ok: true, items: await listAllItems() });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = await denied();
  if (blocked) return blocked;

  const { id } = await context.params;
  const orphaned = await deleteItem(id);
  if (!orphaned) return Response.json({ error: "그 상품을 찾지 못했습니다." }, { status: 404 });

  // The rows are gone either way; a file left behind is untidy, not broken.
  const { env } = await import("cloudflare:workers");
  for (const key of orphaned) await env.BUCKET?.delete(key).catch(() => undefined);

  return Response.json({ ok: true, items: await listAllItems() });
}
