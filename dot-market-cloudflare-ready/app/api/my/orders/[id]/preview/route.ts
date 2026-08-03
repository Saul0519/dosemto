import { currentUser } from "../../../../../../db/discord-session";
import { getOwnOrderPreview } from "../../../../../../db/orders";

export const dynamic = "force-dynamic";

/** Serves a customer their own converted pattern. Scoped by snowflake. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(request).catch(() => null);
  if (!user) return new Response("로그인이 필요합니다.", { status: 401 });

  const { id } = await context.params;
  const file = await getOwnOrderPreview(id, user.id).catch(() => null);
  if (!file) return new Response("찾을 수 없습니다.", { status: 404 });

  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return new Response("저장소가 연결되지 않았습니다.", { status: 503 });
  const object = await env.BUCKET.get(file.objectKey);
  if (!object) return new Response("찾을 수 없습니다.", { status: 404 });

  return new Response(object.body, {
    headers: {
      "content-type": file.contentType,
      "cache-control": "private, max-age=300",
      "content-disposition": `inline; filename="${file.filename}"`,
    },
  });
}
