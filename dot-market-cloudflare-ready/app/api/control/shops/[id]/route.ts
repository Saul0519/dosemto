import { getChatGPTUser } from "../../../../chatgpt-auth";
import { isSuperAdmin, listAllShops, updateShopControl } from "../../../../../db/shops";

export const dynamic = "force-dynamic";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 변경할 수 있습니다." }, { status: 403 });
  }
  const body = await request.json() as Record<string, unknown>;
  const managerEmail = String(body.managerEmail ?? "").trim().toLowerCase();
  if (!validEmail(managerEmail) || typeof body.active !== "boolean") {
    return Response.json({ error: "관리자 이메일과 공개 상태를 확인해 주세요." }, { status: 400 });
  }
  const { id } = await context.params;
  await updateShopControl(id, { managerEmail, active: body.active });
  const shops = await listAllShops();
  return Response.json({ ok: true, shop: shops.find((shop) => shop.id === id) ?? null });
}
