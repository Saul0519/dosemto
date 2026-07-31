import { getChatGPTUser } from "../../../../../../chatgpt-auth";
import { getOrderFileForManager } from "../../../../../../../db/orders";

export const dynamic = "force-dynamic";

function asciiFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "download";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id, kind } = await context.params;
  if (kind !== "preview" && kind !== "original") return new Response("Not found", { status: 404 });
  const file = await getOrderFileForManager(id, user.email, kind);
  if (!file) return new Response("Not found", { status: 404 });

  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return new Response("Storage unavailable", { status: 503 });
  const object = await env.BUCKET.get(file.objectKey);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  headers.set("content-type", file.contentType);
  headers.set("content-disposition", `attachment; filename="${asciiFilename(file.filename)}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
