import { getChatGPTUser } from "../../../../chatgpt-auth";
import { createItem, listAllItems } from "../../../../../db/store";
import { isSuperAdmin } from "../../../../../db/shops";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { name?: string } | null;
  await createItem(String(body?.name ?? "새 상품"));
  return Response.json({ ok: true, items: await listAllItems() });
}
