import { consumeAction } from "../../../../db/order-actions";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  working: "작업 중",
  cancelled: "취소",
  completed: "완료",
};

/**
 * Spends an action link. POST only — a GET would be burned by any client that
 * prefetches the URL to build a link preview.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  let result: Awaited<ReturnType<typeof consumeAction>>;
  try {
    result = await consumeAction(token);
  } catch {
    return Response.json({ error: "주문 정보를 읽지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  if (!result) {
    return Response.json({ error: "이미 사용했거나 쓸 수 없는 링크입니다." }, { status: 409 });
  }

  // Only a finished order has a review link to hand over. The page checks that
  // the visitor owns the order, so the number alone is safe to share.
  const reviewUrl = result.action === "complete"
    ? `${new URL(request.url).origin}/review/${result.orderId}`
    : null;

  await editNotification(result.orderId, result.action, result.shopId).catch(() => undefined);

  return Response.json({
    ok: true,
    orderId: result.orderId,
    status: result.status,
    statusLabel: STATUS_LABELS[result.status] ?? result.status,
    reviewUrl,
  });
}

/** Marks the original Discord notification so the channel shows what happened. */
async function editNotification(orderId: string, action: string, shopId: string) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) return;

  const row = await env.DB.prepare(
    "SELECT webhook_message_id FROM orders WHERE id = ?",
  ).bind(orderId).first<{ webhook_message_id: string | null }>().catch(() => null);
  if (!row?.webhook_message_id) return;

  const shop = await env.DB.prepare(
    "SELECT webhook_ciphertext, webhook_iv FROM shops WHERE id = ?",
  ).bind(shopId).first<{ webhook_ciphertext: string | null; webhook_iv: string | null }>().catch(() => null);
  if (!shop?.webhook_ciphertext || !shop.webhook_iv) return;

  const { decryptWebhook } = await import("../../../../db/webhook-crypto");
  const webhook = await decryptWebhook(shop.webhook_ciphertext, shop.webhook_iv).catch(() => null);
  if (!webhook) return;

  const { ACTION_LABELS } = await import("../../../../db/order-actions");
  const mark = action === "reject" ? "🚫" : action === "complete" ? "✅" : "🛠️";

  await fetch(`${webhook}/messages/${row.webhook_message_id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `${mark} **${orderId}** · ${ACTION_LABELS[action as keyof typeof ACTION_LABELS]} 처리됨`,
    }),
  }).catch(() => undefined);
}
