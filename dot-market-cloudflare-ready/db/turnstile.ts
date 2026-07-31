type TurnstileResult = {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export async function turnstileSiteKey() {
  const { env } = await import("cloudflare:workers");
  return typeof env.TURNSTILE_SITE_KEY === "string" ? env.TURNSTILE_SITE_KEY.trim() : "";
}

export async function verifyTurnstile(request: Request, token: string) {
  const { env } = await import("cloudflare:workers");
  const secret = typeof env.TURNSTILE_SECRET_KEY === "string" ? env.TURNSTILE_SECRET_KEY.trim() : "";
  if (!secret) {
    return { ok: false as const, status: 503, error: "주문 보안 인증 설정이 아직 완료되지 않았습니다." };
  }
  if (!token || token.length > 2048) {
    return { ok: false as const, status: 400, error: "로봇 방지 인증을 완료해 주세요." };
  }

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  const remoteIp = request.headers.get("cf-connecting-ip");
  if (remoteIp) body.append("remoteip", remoteIp);
  body.append("idempotency_key", crypto.randomUUID());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false as const, status: 503, error: "보안 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    const result = await response.json() as TurnstileResult;
    const requestHostname = new URL(request.url).hostname.toLowerCase();
    if (
      !result.success ||
      result.action !== "place_order" ||
      (result.hostname && result.hostname.toLowerCase() !== requestHostname)
    ) {
      return { ok: false as const, status: 403, error: "로봇 방지 인증이 만료되었거나 올바르지 않습니다. 다시 인증해 주세요." };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 503, error: "보안 인증을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  } finally {
    clearTimeout(timeout);
  }
}

