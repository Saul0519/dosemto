import { getPopupObjectKey } from "../../../db/popup";

export const dynamic = "force-dynamic";

export async function GET() {
  const stored = await getPopupObjectKey();
  if (!stored) return new Response("Not found", { status: 404 });

  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return new Response("Storage unavailable", { status: 503 });
  const object = await env.BUCKET.get(stored.objectKey);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType || stored.contentType);
  // Short: the popup changes when the owner says so, and the URL never does.
  headers.set("cache-control", "public, max-age=300, stale-while-revalidate=3600");
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
