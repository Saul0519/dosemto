/**
 * "Sign in with Discord".
 *
 * The whole service already runs on Discord — shops are notified there and
 * customers are contacted there — so the account that matters is the Discord
 * one. Signing in gets the numeric snowflake, which is what a bot needs to DM
 * someone; a username typed into a form cannot be messaged and cannot be
 * trusted to be the person typing it.
 *
 * The signed-in user is kept in an HMAC-signed cookie rather than a database
 * session: there is nothing to store beyond an id and a name, and a stateless
 * cookie survives Workers having no shared memory between requests.
 */

export const SESSION_COOKIE = "dm_user";
export const STATE_COOKIE = "dm_state";

/** Chosen when the visitor ticks "30일 동안 로그인 유지". */
export const REMEMBER_SECONDS = 60 * 60 * 24 * 30;

export type DiscordUser = {
  /** Snowflake. The only form a bot can DM. */
  id: string;
  /** Global display name where set, otherwise the account name. */
  name: string;
  exp: number;
};

export async function discordConfig() {
  const { env } = await import("cloudflare:workers");
  const clientId = typeof env.DISCORD_CLIENT_ID === "string" ? env.DISCORD_CLIENT_ID.trim() : "";
  const clientSecret = typeof env.DISCORD_CLIENT_SECRET === "string" ? env.DISCORD_CLIENT_SECRET.trim() : "";
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

/**
 * Derived from WEBHOOK_ENCRYPTION_KEY under its own label, so operators manage
 * one secret and the two uses can never produce the same key.
 */
async function signingKey() {
  const { env } = await import("cloudflare:workers");
  const secret = typeof env.WEBHOOK_ENCRYPTION_KEY === "string" ? env.WEBHOOK_ENCRYPTION_KEY : "";
  if (secret.length < 24) throw new Error("세션 서명 키가 설정되지 않았습니다.");
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`discord-session ${secret}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded + "=".repeat((4 - padded.length % 4) % 4)), (c) => c.charCodeAt(0));
};

/** Long enough to finish what you came to do, short enough to be worth losing. */
export const SESSION_SECONDS = 12 * 60 * 60;

export async function signUser(user: Omit<DiscordUser, "exp">, seconds = REMEMBER_SECONDS) {
  // The token carries its own life. Someone who did not ask to be remembered
  // should not be handed a month-long one just because the cookie goes away
  // when the browser does.
  const payload: DiscordUser = { ...user, exp: Math.floor(Date.now() / 1000) + seconds };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(signature))}`;
}

export async function verifyUser(value: string | undefined | null): Promise<DiscordUser | null> {
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
    const user = JSON.parse(new TextDecoder().decode(fromB64url(body))) as DiscordUser;
    if (!user.id || !user.name) return null;
    if (user.exp * 1000 < Date.now()) return null;
    return user;
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
 * which is what leaving "remember me" unticked should mean.
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

/** Only same-origin paths, so the login flow cannot become an open redirect. */
export function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function currentUser(request: Request) {
  return verifyUser(readCookie(request, SESSION_COOKIE));
}
