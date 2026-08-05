import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getPopupObjectKeyForOwner } from "../../../../../db/popup";
import { isSuperAdmin } from "../../../../../db/shops";

export const dynamic = "force-dynamic";

/**
 * The popup picture for the control panel.
 *
 * The public route serves nothing while the popup is switched off, and a newly
 * uploaded one starts switched off — so without this the owner's preview would
 * be a broken image exactly when they most need to look at it.
 */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) return new Response("Forbidden", { status: 403 });

  const stored = await getPopupObjectKeyForOwner();
  if (!stored) return new Response("Not found", { status: 404 });

  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return new Response("Storage unavailable", { status: 503 });
  const object = await env.BUCKET.get(stored.objectKey);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType || stored.contentType);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
