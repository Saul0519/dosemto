import { validateImageFile } from "../../../db/image-validation";
import { createOrder, setOrderMessageId, setOrderWebhookResult } from "../../../db/orders";
import { ACTION_LABELS, issueOrderTokens, randomToken } from "../../../db/order-actions";
import { getOrderShop } from "../../../db/shops";
import { verifyTurnstile } from "../../../db/turnstile";
import { decryptWebhook } from "../../../db/webhook-crypto";

export const dynamic = "force-dynamic";

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

function numberField(form: FormData, name: string) {
  return Number(form.get(name));
}

function orderId() {
  const date = new Date();
  const day = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  // Six hex characters off a UUID is 24 bits, which starts colliding within a
  // single day's orders. randomToken draws from a wider, unambiguous alphabet.
  return `DO-${day}-${randomToken(8)}`;
}

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "image";
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "주문 파일 전체 크기는 20MB를 넘을 수 없습니다." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "주문 데이터를 읽지 못했습니다." }, { status: 400 });
  }

  const captcha = await verifyTurnstile(request, String(form.get("captchaToken") ?? ""));
  if (!captcha.ok) {
    return Response.json({ error: captcha.error }, { status: captcha.status });
  }

  const shopSlug = String(form.get("shopSlug") ?? "").trim();
  const shop = await getOrderShop(shopSlug);
  if (!shop) {
    return Response.json({ error: "현재 주문을 받을 수 없는 샵입니다." }, { status: 404 });
  }
  if (!shop.webhookCiphertext || !shop.webhookIv) {
    return Response.json({ error: "이 샵의 주문 알림 설정이 아직 완료되지 않았습니다." }, { status: 503 });
  }

  let webhook: string;
  try {
    webhook = await decryptWebhook(shop.webhookCiphertext, shop.webhookIv);
  } catch {
    return Response.json({ error: "샵의 주문 알림 설정을 확인해 주세요." }, { status: 503 });
  }
  if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(webhook)) {
    return Response.json({ error: "샵의 디스코드 웹훅 주소가 올바르지 않습니다." }, { status: 503 });
  }

  const preview = form.get("preview");
  const original = form.get("original");
  const contact = String(form.get("contact") ?? "").trim().slice(0, 100);
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);
  const cropLabel = String(form.get("cropLabel") ?? "자르기 없음").slice(0, 100);
  const originalFilename = safeFilename(String(form.get("originalFilename") ?? "image"));
  const gridX = numberField(form, "gridX");
  const gridY = numberField(form, "gridY");
  const deadline = numberField(form, "deadline");
  if (!(preview instanceof File) || !contact) {
    return Response.json({ error: "이미지와 디스코드 ID를 확인해 주세요." }, { status: 400 });
  }
  if (![gridX, gridY, deadline].every(Number.isInteger) || gridX < 1 || gridX > 30 || gridY < 1 || gridY > 100 || deadline < 1 || deadline > 7) {
    return Response.json({ error: "격자 크기 또는 마감일이 올바르지 않습니다." }, { status: 400 });
  }

  let previewFile: Awaited<ReturnType<typeof validateImageFile>>;
  let originalFile: Awaited<ReturnType<typeof validateImageFile>> | null = null;
  try {
    previewFile = await validateImageFile(preview, { maxBytes: MAX_PREVIEW_BYTES, requiredMime: "image/png" });
    if (original instanceof File && original.size > 0) {
      originalFile = await validateImageFile(original, { maxBytes: MAX_ORIGINAL_BYTES });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "이미지 형식을 확인해 주세요." }, { status: 400 });
  }

  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) {
    return Response.json({ error: "주문 이미지 저장소가 연결되지 않았습니다." }, { status: 503 });
  }

  const tiles = gridX * gridY;
  const multiplier = shop.pricing.deadlineMultipliers[String(deadline)] ?? 1;
  const calculatedPrice = Math.round((tiles * shop.pricing.tilePrice * multiplier) / 100) * 100;
  const id = orderId();
  const previewObjectKey = `orders/${shop.id}/${id}/preview.png`;
  const originalObjectKey = originalFile ? `orders/${shop.id}/${id}/original.${originalFile.extension}` : null;

  try {
    await env.BUCKET.put(previewObjectKey, await preview.arrayBuffer(), {
      httpMetadata: { contentType: previewFile.mime },
    });
    if (originalFile && original instanceof File && originalObjectKey) {
      await env.BUCKET.put(originalObjectKey, await original.arrayBuffer(), {
        httpMetadata: { contentType: originalFile.mime },
      });
    }
    await createOrder({
      id,
      shopId: shop.id,
      contact,
      note,
      gridX,
      gridY,
      tileCount: tiles,
      deadline,
      totalPrice: calculatedPrice,
      cropLabel,
      originalFilename,
      previewObjectKey,
      previewContentType: previewFile.mime,
      originalObjectKey,
      originalContentType: originalFile?.mime ?? null,
    });
  } catch {
    await env.BUCKET.delete(previewObjectKey);
    if (originalObjectKey) await env.BUCKET.delete(originalObjectKey);
    return Response.json({ error: "주문 기록을 안전하게 저장하지 못했습니다. 다시 시도해 주세요." }, { status: 503 });
  }

  // Single-use links so the shop can act straight from Discord. Issued after
  // the order row exists; if this fails the notification still goes out and the
  // admin page remains the way to change status.
  const origin = new URL(request.url).origin;
  let actionLinks = "";
  try {
    const tokens = await issueOrderTokens(id);
    actionLinks = (["accept", "reject", "complete"] as const)
      .map((action) => `[${ACTION_LABELS[action]}](${origin}/a/${tokens.actions[action]})`)
      .join("  ·  ");
  } catch {
    actionLinks = "";
  }

  const discordForm = new FormData();
  discordForm.append("payload_json", JSON.stringify({
    username: `${shop.name} 주문 알림`,
    content: `📦 **${shop.name}**에 새 주문이 도착했습니다 · **${id}**`,
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `${gridX}×${gridY} 도안 주문`,
      color: 0xff6157,
      description: actionLinks
        ? `**처리하기**\n${actionLinks}\n\n각 링크는 한 번만 쓸 수 있습니다.`
        : undefined,
      fields: [
        { name: "연락처", value: contact, inline: true },
        { name: "마감", value: `${deadline}일`, inline: true },
        { name: "예상 금액", value: `${calculatedPrice.toLocaleString("ko-KR")}원`, inline: true },
        { name: "규격", value: `${gridX}×${gridY} · ${tiles}장 · 장당 32×32`, inline: false },
        { name: "가장자리 처리", value: cropLabel, inline: false },
        { name: "원본 파일", value: originalFilename, inline: false },
        { name: "요청사항", value: note || "없음", inline: false },
      ],
      footer: { text: "관리자 페이지의 주문 기록에서도 파일을 확인할 수 있습니다." },
      timestamp: new Date().toISOString(),
    }],
  }));
  discordForm.append("files[0]", preview, `DOT_ORDER_${id}_${gridX}x${gridY}.png`);
  if (originalFile && original instanceof File) {
    discordForm.append("files[1]", original, `ORIGINAL_${id}.${originalFile.extension}`);
  }

  let webhookSent = false;
  const webhookController = new AbortController();
  const webhookTimeout = setTimeout(() => webhookController.abort(), 8_000);
  try {
    // wait=true makes Discord return the created message, whose id is needed to
    // edit the notification later when the shop acts on the order.
    const response = await fetch(`${webhook}${webhook.includes("?") ? "&" : "?"}wait=true`, {
      method: "POST",
      body: discordForm,
      signal: webhookController.signal,
    });
    webhookSent = response.ok;
    if (response.ok) {
      const message = await response.json().catch(() => null) as { id?: string } | null;
      if (message?.id) await setOrderMessageId(id, message.id);
    }
  } catch {
    webhookSent = false;
  } finally {
    clearTimeout(webhookTimeout);
  }
  await setOrderWebhookResult(id, webhookSent);
  if (!webhookSent) {
    return Response.json({ error: `주문 ${id}은 기록했지만 디스코드 알림 전송에 실패했습니다. 샵 관리자에게 알려주세요.`, orderId: id }, { status: 502 });
  }
  return Response.json({ ok: true, orderId: id, totalPrice: calculatedPrice });
}
