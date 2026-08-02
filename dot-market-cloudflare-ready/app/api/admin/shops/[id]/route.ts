import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getShopForManager, updateShopSettings, validPricing } from "../../../../../db/shops";
import { encryptWebhook } from "../../../../../db/webhook-crypto";

export const dynamic = "force-dynamic";

function validWebhook(value: string) {
  return /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(value);
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "ChatGPT 로그인이 필요합니다." }, { status: 401 });
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

  let webhookCiphertext: string | null | undefined;
  let webhookIv: string | null | undefined;
  if (body.removeWebhook === true) {
    webhookCiphertext = null;
    webhookIv = null;
  } else if (typeof body.webhook === "string" && body.webhook.trim()) {
    const webhook = body.webhook.trim();
    if (!validWebhook(webhook)) {
      return Response.json({ error: "디스코드 웹훅 URL을 확인해 주세요." }, { status: 400 });
    }
    try {
      const encrypted = await encryptWebhook(webhook);
      webhookCiphertext = encrypted.ciphertext;
      webhookIv = encrypted.iv;
    } catch {
      // encryptWebhook throws when WEBHOOK_ENCRYPTION_KEY is missing or too
      // short. Letting it escape produced an empty 500, which the panel then
      // failed to parse — the operator saw a JSON error instead of the cause.
      return Response.json({
        error: "웹훅을 암호화할 수 없습니다. Worker 설정의 Variables and Secrets에 "
          + "WEBHOOK_ENCRYPTION_KEY(24자 이상)를 추가한 뒤 다시 저장해 주세요.",
      }, { status: 503 });
    }
  }

  try {
    await updateShopSettings(id, {
      name,
      description,
      aboutTitle,
      aboutText,
      pricing: body.pricing,
      webhookCiphertext,
      webhookIv,
    });
  } catch {
    return Response.json({ error: "샵 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }

  return Response.json({ ok: true, shop: await getShopForManager(id, user.email) });
}
