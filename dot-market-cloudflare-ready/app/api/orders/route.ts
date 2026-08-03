import { validateImageFile } from "../../../db/image-validation";
import { createOrder, setOrderMessageId, setOrderWebhookResult, countActiveOrders, findOpenOrderFor } from "../../../db/orders";
import { randomToken } from "../../../db/order-actions";
import { currentUser } from "../../../db/discord-session";
import { postOrderMessage } from "../../../db/discord-bot";
import { getOrderShop } from "../../../db/shops";
import { slotState } from "../../../db/slots";
import { verifyTurnstile } from "../../../db/turnstile";

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

  // Every order is tied to a signed-in Discord account. Converting an image and
  // downloading the pattern stay open; only submitting an order needs this.
  // The snowflake is also the only thing a bot can DM later.
  const orderer = await currentUser(request).catch(() => null);
  if (!orderer) {
    return Response.json(
      { error: "디스코드로 로그인한 뒤 주문할 수 있습니다." },
      { status: 401 },
    );
  }

  const shopSlug = String(form.get("shopSlug") ?? "").trim();
  const shop = await getOrderShop(shopSlug);
  if (!shop) {
    return Response.json({ error: "현재 주문을 받을 수 없는 샵입니다." }, { status: 404 });
  }
  if (!shop.channelId) {
    return Response.json({ error: "이 샵의 주문 알림 채널이 아직 설정되지 않았습니다." }, { status: 503 });
  }

  // Checked here as well as in the browser, because the queue can fill between
  // loading the page and pressing the button.
  // One open order per person per shop. Checked before the slot gate so someone
  // holding an order is told that, rather than being told the shop is busy.
  const open = await findOpenOrderFor(shop.id, orderer.id).catch(() => null);
  if (open) {
    return Response.json({
      error: `이미 ${shop.name}에 진행 중인 주문(${open.id})이 있습니다. 그 작업이 끝나거나 취소된 뒤에 다시 주문해 주세요.`,
    }, { status: 409 });
  }

  const slots = slotState(shop, await countActiveOrders(shop.id).catch(() => 0));
  if (slots.full) {
    return Response.json({
      error: `지금은 ${shop.name}의 접수 슬롯이 모두 찼습니다 (${slots.used}/${slots.max}). 진행 중인 작업이 끝나면 다시 열립니다.`,
    }, { status: 409 });
  }

  const preview = form.get("preview");
  const original = form.get("original");
  // No longer typed by hand: the signed-in account is the contact, which also
  // means it cannot be someone else's name.
  const contact = `${orderer.name} (${orderer.id})`.slice(0, 100);
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);
  const cropLabel = String(form.get("cropLabel") ?? "자르기 없음").slice(0, 100);
  const originalFilename = safeFilename(String(form.get("originalFilename") ?? "image"));
  const gridX = numberField(form, "gridX");
  const gridY = numberField(form, "gridY");
  const deadline = numberField(form, "deadline");
  if (!(preview instanceof File)) {
    return Response.json({ error: "변환한 도안 이미지를 찾지 못했습니다." }, { status: 400 });
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
      playerUuid: orderer.id,
      playerName: orderer.name,
    });
  } catch {
    await env.BUCKET.delete(previewObjectKey);
    if (originalObjectKey) await env.BUCKET.delete(originalObjectKey);
    return Response.json({ error: "주문 기록을 안전하게 저장하지 못했습니다. 다시 시도해 주세요." }, { status: 503 });
  }

  const notice = await postOrderMessage({
    channelId: shop.channelId,
    content: `📦 **${shop.name}**에 새 주문이 도착했습니다 · **${id}**`,
    embed: {
      title: `${gridX}×${gridY} 도안 주문`,
      color: 0xff6157,
      fields: [
        { name: "주문자", value: `${orderer.name} (<@${orderer.id}>)`, inline: true },
        { name: "마감", value: `${deadline}일`, inline: true },
        { name: "예상 금액", value: `${calculatedPrice.toLocaleString("ko-KR")}원`, inline: true },
        { name: "규격", value: `${gridX}×${gridY} · ${tiles}장 · 장당 32×32`, inline: false },
        { name: "가장자리 처리", value: cropLabel, inline: false },
        { name: "원본 파일", value: originalFilename, inline: false },
        { name: "요청사항", value: note || "없음", inline: false },
      ],
      footer: { text: "버튼을 누르면 주문자에게 자동으로 안내가 갑니다." },
      timestamp: new Date().toISOString(),
    },
    buttons: [
      { customId: `accept:${id}`, label: "수락", style: 3, emoji: "✅" },
      { customId: `reject:${id}`, label: "거절", style: 4, emoji: "🚫" },
    ],
    files: [
      { name: `DOT_ORDER_${id}_${gridX}x${gridY}.png`, blob: preview },
      ...(originalFile && original instanceof File
        ? [{ name: `ORIGINAL_${id}.${originalFile.extension}`, blob: original }]
        : []),
    ],
  }).catch(() => ({ ok: false as const, error: "디스코드에 알림을 보내지 못했습니다." }));

  await setOrderWebhookResult(id, notice.ok);
  if (!notice.ok) {
    return Response.json({
      error: `주문 ${id}은 기록했지만 디스코드 알림 전송에 실패했습니다. ${notice.error} 샵 관리자에게 알려주세요.`,
      orderId: id,
    }, { status: 502 });
  }
  if (notice.messageId) await setOrderMessageId(id, notice.messageId);

  return Response.json({ ok: true, orderId: id, totalPrice: calculatedPrice });
}
