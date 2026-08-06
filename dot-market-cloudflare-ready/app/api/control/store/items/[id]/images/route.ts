import { getChatGPTUser } from "../../../../../../chatgpt-auth";
import { addItemImage, getItem, listAllItems, reorderItemImages } from "../../../../../../../db/store";
import { MAX_ITEM_IMAGES } from "../../../../../../../db/store-plans";
import { validateImageFile } from "../../../../../../../db/image-validation";
import { isSuperAdmin } from "../../../../../../../db/shops";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }

  const { id } = await context.params;
  const item = await getItem(id);
  if (!item) return Response.json({ error: "그 상품을 찾지 못했습니다." }, { status: 404 });

  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return Response.json({ error: "이미지 저장소가 연결되지 않았습니다." }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const files = form?.getAll("images").filter((value): value is File => value instanceof File && value.size > 0) ?? [];
  if (files.length === 0) return Response.json({ error: "사진을 골라주세요." }, { status: 400 });
  if (item.images.length + files.length > MAX_ITEM_IMAGES) {
    return Response.json({
      error: `사진은 상품당 최대 ${MAX_ITEM_IMAGES}장입니다. 지금 ${item.images.length}장 올라가 있습니다.`,
    }, { status: 400 });
  }

  try {
    for (const file of files) {
      const validated = await validateImageFile(file, { maxBytes: 12 * 1024 * 1024 });
      const objectKey = `store/${id}/${crypto.randomUUID()}.${validated.extension}`;
      await env.BUCKET.put(objectKey, await file.arrayBuffer(), {
        httpMetadata: { contentType: validated.mime },
      });
      try {
        await addItemImage({ itemId: id, objectKey, filename: file.name.slice(0, 180), contentType: validated.mime });
      } catch (error) {
        // The row is what makes the file reachable, so a failed insert leaves
        // an object nothing can ever point at.
        await env.BUCKET.delete(objectKey);
        throw error;
      }
    }
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "사진을 올리지 못했습니다.",
    }, { status: 400 });
  }

  return Response.json({ ok: true, items: await listAllItems() });
}

/** The new left-to-right order. Whatever ends up first becomes the card cover. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { order?: unknown } | null;
  const order = Array.isArray(body?.order) ? body.order.map((value) => String(value)) : null;
  if (!order) return Response.json({ error: "순서를 읽지 못했습니다." }, { status: 400 });

  if (!(await reorderItemImages(id, order))) {
    return Response.json({ error: "순서를 바꾸지 못했습니다." }, { status: 400 });
  }
  return Response.json({ ok: true, items: await listAllItems() });
}
