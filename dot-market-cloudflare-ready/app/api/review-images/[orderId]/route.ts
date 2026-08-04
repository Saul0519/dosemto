import { getVisibleReviewImageKey } from "../../../../db/reviews";

export const dynamic = "force-dynamic";

/**
 * Serves the photo a customer attached to their review.
 *
 * Keyed on the order rather than a file name, and the lookup only answers while
 * the review is visible and its shop is active — so hiding a review takes its
 * picture down with it rather than leaving a URL that still works.
 */
export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  const objectKey = await getVisibleReviewImageKey(orderId).catch(() => null);
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
