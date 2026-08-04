import { getChatGPTUser } from "../../../../chatgpt-auth";
import {
  deleteShopCascade,
  isSuperAdmin,
  listAllShops,
  updateShopControl,
} from "../../../../../db/shops";

export const dynamic = "force-dynamic";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 변경할 수 있습니다." }, { status: 403 });
  }
  const body = await request.json() as Record<string, unknown>;
  const managerEmail = String(body.managerEmail ?? "").trim().toLowerCase();
  if (!validEmail(managerEmail) || typeof body.active !== "boolean") {
    return Response.json({ error: "관리자 이메일과 공개 상태를 확인해 주세요." }, { status: 400 });
  }
  const { id } = await context.params;
  await updateShopControl(id, {
    managerEmail,
    active: body.active,
    premium: body.premium === true,
    featureRank: Number(body.featureRank) || 0,
  });
  const shops = await listAllShops();
  return Response.json({ ok: true, shop: shops.find((shop) => shop.id === id) ?? null });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 샵을 삭제할 수 있습니다." }, { status: 403 });
  }

  const { id } = await context.params;
  const shops = await listAllShops();
  const target = shops.find((shop) => shop.id === id);
  if (!target) return Response.json({ error: "이미 없는 샵입니다." }, { status: 404 });

  // Typing the slug is the guard against a misclick. This wipes order history
  // and the stored files with it, and none of it is recoverable.
  const confirm = new URL(request.url).searchParams.get("confirm") ?? "";
  if (confirm !== target.slug) {
    return Response.json(
      { error: `삭제하려면 샵 주소 "${target.slug}"를 정확히 입력해 주세요.` },
      { status: 400 },
    );
  }

  const removed = await deleteShopCascade(id);
  if (!removed) return Response.json({ error: "이미 없는 샵입니다." }, { status: 404 });

  // Rows are already gone; a failed purge would only leave unreferenced blobs,
  // so it must not turn a completed delete into an error.
  const { env } = await import("cloudflare:workers");
  let purged = 0;
  if (env.BUCKET) {
    for (const key of removed.objectKeys) {
      try {
        await env.BUCKET.delete(key);
        purged += 1;
      } catch {
        // leave it; the shop is gone either way
      }
    }
  }

  return Response.json({
    ok: true,
    removed: {
      name: removed.name,
      slug: removed.slug,
      orderCount: removed.orderCount,
      reviewCount: removed.reviewCount,
      imageCount: removed.imageCount,
      filesPurged: purged,
      filesTotal: removed.objectKeys.length,
    },
    shops: await listAllShops(),
  });
}
