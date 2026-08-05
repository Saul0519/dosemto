import { getStoreImageObjectKey } from "../../../../db/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await context.params;
  const objectKey = await getStoreImageObjectKey(imageId);
  if (!objectKey) return new Response("Not found", { status: 404 });

  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return new Response("Storage unavailable", { status: 503 });
  const object = await env.BUCKET.get(objectKey);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType || "image/jpeg");
  headers.set("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
