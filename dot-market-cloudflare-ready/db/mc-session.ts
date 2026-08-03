/**
 * "Sign in with Minecraft" via Mc-Auth (https://mc-auth.com).
 *
 * Going direct — Microsoft → Xbox Live → XSTS → api.minecraftservices.com — is
 * open to websites too, but the app has to be added to Mojang's allow list
 * first (aka.ms/mce-reviewappid); until then that API answers 403. Mc-Auth is
 * an already-approved broker that performs the handshake and hands back a
 * verified UUID and name, so it stands in until our own application clears.
 *
 * Its flow costs the user more steps: they have to launch Minecraft and connect
 * to mc-auth.com to be kicked with a code. Swapping to a direct Microsoft login
 * cuts that to a single button, and only this file plus the two /api/mc routes
 * need to change.
 *
 * The signed-in player is kept in an HMAC-signed cookie rather than a database
 * session: there is nothing to store beyond a name and a UUID, and a stateless
 * cookie survives Workers having no shared memory between requests.
 */

export const MC_SESSION_COOKIE = "mc_player";
export const MC_STATE_COOKIE = "mc_state";
/** "30일 동안 로그인 유지"를 골랐을 때. 고르지 않으면 브라우저를 닫을 때까지만. */
export const REMEMBER_SECONDS = 60 * 60 * 24 * 30;
const MAX_AGE_SECONDS = REMEMBER_SECONDS;

export type McPlayer = { uuid: string; name: string; exp: number };


export async function mcAuthConfig() {
  const { env } = await import("cloudflare:workers");
  const clientId = typeof env.MC_AUTH_CLIENT_ID === "string" ? env.MC_AUTH_CLIENT_ID.trim() : "";
  const clientSecret = typeof env.MC_AUTH_CLIENT_SECRET === "string" ? env.MC_AUTH_CLIENT_SECRET.trim() : "";
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

/**
 * Derived from WEBHOOK_ENCRYPTION_KEY with its own label so the two uses can
 * never produce the same key, and so operators have one secret to manage
 * instead of two.
 */
async function signingKey() {
  const { env } = await import("cloudflare:workers");
  const secret = typeof env.WEBHOOK_ENCRYPTION_KEY === "string" ? env.WEBHOOK_ENCRYPTION_KEY : "";
  if (secret.length < 24) throw new Error("세션 서명 키가 설정되지 않았습니다.");
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`mc-session ${secret}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded + "=".repeat((4 - padded.length % 4) % 4)), (c) => c.charCodeAt(0));
};

export async function signPlayer(player: Omit<McPlayer, "exp">) {
  const payload: McPlayer = { ...player, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(signature))}`;
}

export async function verifyPlayer(value: string | undefined | null): Promise<McPlayer | null> {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      fromB64url(signature),
      new TextEncoder().encode(body),
    );
    if (!valid) return null;
    const player = JSON.parse(new TextDecoder().decode(fromB64url(body))) as McPlayer;
    if (!player.uuid || !player.name) return null;
    if (player.exp * 1000 < Date.now()) return null;
    return player;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * maxAge of null makes it a session cookie — gone when the browser closes,
 * which is what "remember me" being unticked should mean.
 */
export function cookieHeader(name: string, value: string, maxAge: number | null) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ];
  if (maxAge !== null) attributes.push(`Max-Age=${maxAge}`);
  return attributes.join("; ");
}

/** Only same-origin paths, so the login flow cannot be used as an open redirect. */
export function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function currentPlayer(request: Request) {
  return verifyPlayer(readCookie(request, MC_SESSION_COOKIE));
}
