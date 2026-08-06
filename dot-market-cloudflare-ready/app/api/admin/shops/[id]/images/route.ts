import { getChatGPTUser } from "../../../../../chatgpt-auth";
import { addShopImage, getShopForManager, reorderShopImages } from "../../../../../../db/shops";
import { validateImageFile } from "../../../../../../db/image-validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 });
  const { id } = await context.params;
  const shop = await getShopForManager(id, user.email);
  if (!shop) {
    return Response.json({ error: "이 샵을 관리할 권한이 없습니다." }, { status: 403 });
  }
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return Response.json({ error: "이미지 저장소가 연결되지 않았습니다." }, { status: 503 });

  const form = await request.formData();
  const files = form.getAll("images").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0 || files.length > 10) {
    return Response.json({ error: "한 번에 이미지 1~10장을 선택해 주세요." }, { status: 400 });
  }
  if (shop.images.length + files.length > 10) {
    return Response.json({ error: `이미지는 샵당 최대 10장입니다. 현재 ${shop.images.length}장이 등록되어 있습니다.` }, { status: 400 });
  }
  try {
    for (const file of files) {
      const validated = await validateImageFile(file, { maxBytes: 12 * 1024 * 1024 });
      const objectKey = `shops/${id}/${crypto.randomUUID()}.${validated.extension}`;
      await env.BUCKET.put(objectKey, await file.arrayBuffer(), {
        httpMetadata: { contentType: validated.mime },
      });
      try {
        await addShopImage({ shopId: id, objectKey, filename: file.name.slice(0, 180), contentType: validated.mime });
      } catch (error) {
        await env.BUCKET.delete(objectKey);
        throw error;
      }
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "이미지를 저장하지 못했습니다." }, { status: 400 });
  }
  return Response.json({ ok: true, shop: await getShopForManager(id, user.email) });
}

/** The new left-to-right order. Whatever ends up first becomes the cover. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 });
  const { id } = await context.params;
  if (!(await getShopForManager(id, user.email))) {
    return Response.json({ error: "이 샵을 관리할 권한이 없습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { order?: unknown } | null;
  const order = Array.isArray(body?.order) ? body.order.map((id) => String(id)) : null;
  if (!order) return Response.json({ error: "순서를 읽지 못했습니다." }, { status: 400 });

  // reorderShopImages ignores ids belonging to anyone else.
  if (!(await reorderShopImages(id, order))) {
    return Response.json({ error: "순서를 바꾸지 못했습니다." }, { status: 400 });
  }
  return Response.json({ ok: true, shop: await getShopForManager(id, user.email) });
}
