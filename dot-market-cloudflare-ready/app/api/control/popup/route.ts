import { getChatGPTUser } from "../../../chatgpt-auth";
import { clearPopupImage, getPopupForOwner, savePopup, setPopupImage } from "../../../../db/popup";
import { validateImageFile } from "../../../../db/image-validation";
import { isSuperAdmin } from "../../../../db/shops";

export const dynamic = "force-dynamic";

async function denied() {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  return null;
}

export async function PUT(request: Request) {
  const blocked = await denied();
  if (blocked) return blocked;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });

  const link = String(body.linkUrl ?? "").trim();
  await savePopup({
    active: body.active === true,
    linkUrl: link,
    alt: String(body.alt ?? ""),
  });

  const popup = await getPopupForOwner();
  // Saying so beats silently dropping it: a mistyped address just vanishes.
  if (link && !popup.linkUrl) {
    return Response.json({
      ok: true,
      popup,
      warning: "주소를 알아보지 못해 링크는 비워뒀습니다. https:// 로 시작하는 주소나 /store 같은 사이트 안 경로를 넣어주세요.",
    });
  }
  return Response.json({ ok: true, popup });
}

export async function POST(request: Request) {
  const blocked = await denied();
  if (blocked) return blocked;

  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return Response.json({ error: "이미지 저장소가 연결되지 않았습니다." }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "이미지를 골라주세요." }, { status: 400 });
  }

  let objectKey: string;
  try {
    const validated = await validateImageFile(file, { maxBytes: 12 * 1024 * 1024 });
    objectKey = `popup/${crypto.randomUUID()}.${validated.extension}`;
    await env.BUCKET.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: validated.mime },
    });
    const previous = await setPopupImage(objectKey, validated.mime).catch(async (error) => {
      await env.BUCKET!.delete(objectKey);
      throw error;
    });
    if (previous) await env.BUCKET.delete(previous).catch(() => undefined);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "이미지를 올리지 못했습니다.",
    }, { status: 400 });
  }

  return Response.json({ ok: true, popup: await getPopupForOwner() });
}

export async function DELETE() {
  const blocked = await denied();
  if (blocked) return blocked;

  const previous = await clearPopupImage();
  if (previous) {
    const { env } = await import("cloudflare:workers");
    await env.BUCKET?.delete(previous).catch(() => undefined);
  }
  return Response.json({ ok: true, popup: await getPopupForOwner() });
}
