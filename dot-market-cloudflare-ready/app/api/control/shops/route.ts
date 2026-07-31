import { getChatGPTUser } from "../../../chatgpt-auth";
import { createShop, isSuperAdmin, validSlug } from "../../../../db/shops";

export const dynamic = "force-dynamic";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 샵을 만들 수 있습니다." }, { status: 403 });
  }
  const body = await request.json() as Record<string, unknown>;
  const slug = String(body.slug ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim().slice(0, 60);
  const description = String(body.description ?? "").trim().slice(0, 300);
  const managerEmail = String(body.managerEmail ?? "").trim().toLowerCase();
  if (!name || !validSlug(slug) || !validEmail(managerEmail)) {
    return Response.json({ error: "샵 이름, 주소, 관리자 이메일을 확인해 주세요." }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, shop: await createShop({ slug, name, description, managerEmail }) });
  } catch (error) {
    const message = error instanceof Error && /unique/i.test(error.message)
      ? "이미 사용 중인 샵 주소입니다."
      : "샵을 만들지 못했습니다.";
    return Response.json({ error: message }, { status: 409 });
  }
}
