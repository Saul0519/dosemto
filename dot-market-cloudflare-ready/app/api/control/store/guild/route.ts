import { getChatGPTUser } from "../../../../chatgpt-auth";
import { clearAllPurchaseRoles, setStoreGuildId } from "../../../../../db/store";
import { isSuperAdmin } from "../../../../../db/shops";

export const dynamic = "force-dynamic";

async function denied() {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  return null;
}

/** The server whose roles get attached to a purchase. Blank switches it off. */
export async function PUT(request: Request) {
  const blocked = await denied();
  if (blocked) return blocked;

  const body = await request.json().catch(() => null) as { guildId?: string } | null;
  const candidate = String(body?.guildId ?? "").trim();
  if (candidate && !/^\d{17,20}$/.test(candidate)) {
    return Response.json({ error: "서버 ID는 숫자만 17~20자리입니다." }, { status: 400 });
  }
  await setStoreGuildId(candidate);
  return Response.json({ ok: true, guildId: candidate });
}

/**
 * Forgets the roles already recorded. Switching the lookup off leaves past
 * records alone, so this is the separate, deliberate way to erase them.
 */
export async function DELETE() {
  const blocked = await denied();
  if (blocked) return blocked;

  const cleared = await clearAllPurchaseRoles().catch(() => 0);
  return Response.json({ ok: true, cleared });
}
