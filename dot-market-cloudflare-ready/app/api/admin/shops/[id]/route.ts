import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getShopForManager, updateShopSettings, validPricing } from "../../../../../db/shops";

export const dynamic = "force-dynamic";

/** Discord snowflakes are 17-20 digit integers. */
function validChannelId(value: string) {
  return /^\d{17,20}$/.test(value);
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 });
  const { id } = await context.params;
  if (!(await getShopForManager(id, user.email))) {
    return Response.json({ error: "이 샵을 관리할 권한이 없습니다." }, { status: 403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const name = String(body.name ?? "").trim().slice(0, 60);
  const description = String(body.description ?? "").trim().slice(0, 300);
  const aboutTitle = String(body.aboutTitle ?? "").trim().slice(0, 100) || "작업 안내";
  const aboutText = String(body.aboutText ?? "").trim().slice(0, 12_000);
  if (!name || !validPricing(body.pricing)) {
    return Response.json({ error: "샵 이름과 가격 설정을 확인해 주세요." }, { status: 400 });
  }

  // Order notifications are posted by the bot now, so a shop is reachable once
  // it names a channel. Blank means "leave as is"; removeChannel clears it.
  let channelId: string | null | undefined;
  if (body.removeChannel === true) {
    channelId = null;
  } else if (typeof body.channelId === "string" && body.channelId.trim()) {
    const candidate = body.channelId.trim();
    if (!validChannelId(candidate)) {
      return Response.json(
        { error: "채널 ID는 숫자만 17~20자리입니다. 디스코드에서 개발자 모드를 켜고 채널을 우클릭해 ID를 복사해 주세요." },
        { status: 400 },
      );
    }
    channelId = candidate;
  }

  try {
    await updateShopSettings(id, {
      name,
      description,
      aboutTitle,
      aboutText,
      pricing: body.pricing,
      channelId,
    });
  } catch {
    return Response.json({ error: "샵 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }

  return Response.json({ ok: true, shop: await getShopForManager(id, user.email) });
}
