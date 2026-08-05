import { getChatGPTUser } from "../../../../chatgpt-auth";
import { setStoreChannelId } from "../../../../../db/store";
import { isSuperAdmin } from "../../../../../db/shops";

export const dynamic = "force-dynamic";

/** Where purchase requests are announced. Blank switches the notice off. */
export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { channelId?: string } | null;
  const candidate = String(body?.channelId ?? "").trim();
  if (candidate && !/^\d{17,20}$/.test(candidate)) {
    return Response.json({ error: "채널 ID는 숫자만 17~20자리입니다." }, { status: 400 });
  }
  await setStoreChannelId(candidate);
  return Response.json({ ok: true, channelId: candidate });
}
