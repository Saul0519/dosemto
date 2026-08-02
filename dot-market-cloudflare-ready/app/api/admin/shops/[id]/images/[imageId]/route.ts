import { getChatGPTUser } from "../../../../../../chatgpt-auth";
import { getShopForManager, getShopImageObjectKey, removeShopImage } from "../../../../../../../db/shops";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; imageId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id, imageId } = await context.params;
  if (!(await getShopForManager(id, user.email))) return new Response("Forbidden", { status: 403 });
  const objectKey = await getShopImageObjectKey(id, imageId);
  if (!objectKey) return new Response("Not found", { status: 404 });
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return new Response("Storage unavailable", { status: 503 });
  const object = await env.BUCKET.get(objectKey);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: {
    "content-type": object.httpMetadata?.contentType || "image/jpeg",
    "cache-control": "private, max-age=300",
    "etag": object.httpEtag,
    "x-content-type-options": "nosniff",
  }});
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; imageId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 });
  const { id, imageId } = await context.params;
  if (!(await getShopForManager(id, user.email))) {
    return Response.json({ error: "이 샵을 관리할 권한이 없습니다." }, { status: 403 });
  }
  const objectKey = await removeShopImage(id, imageId);
  if (!objectKey) return Response.json({ error: "이미지를 찾지 못했습니다." }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  if (env.BUCKET) await env.BUCKET.delete(objectKey);
  return Response.json({ ok: true, shop: await getShopForManager(id, user.email) });
}
