import { getChatGPTUser } from "../../../../../../../chatgpt-auth";
import { listAllItems, removeItemImage } from "../../../../../../../../db/store";
import { isSuperAdmin } from "../../../../../../../../db/shops";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; imageId: string }> }) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }

  const { id, imageId } = await context.params;
  const objectKey = await removeItemImage(id, imageId);
  if (!objectKey) return Response.json({ error: "그 사진을 찾지 못했습니다." }, { status: 404 });

  const { env } = await import("cloudflare:workers");
  await env.BUCKET?.delete(objectKey).catch(() => undefined);

  return Response.json({ ok: true, items: await listAllItems() });
}
