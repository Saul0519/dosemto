/**
 * Headers every response carries.
 *
 * Applied in the worker rather than per route, because a header that protects
 * you only on the pages someone remembered to add it to is not a protection.
 *
 * What each one is actually for:
 *
 * - `frame-ancestors` / `X-Frame-Options` — nobody can put this site in an
 *   iframe. Without it, a page could hide /control under a decoy and have the
 *   owner click buttons they cannot see.
 * - `form-action` — a form on this site cannot post anywhere else, so an
 *   injected form cannot walk off with what someone types.
 * - `base-uri` — an injected `<base>` cannot repoint every relative URL.
 * - `object-src 'none'` — no plugins, ever.
 * - `connect-src` — the browser may only call back here. An injected script
 *   cannot post what it reads to somewhere else.
 * - HSTS — after the first visit the browser refuses plain http to this host,
 *   so there is no request left to intercept and downgrade.
 * - `Referrer-Policy` — an order number in a URL does not travel to other
 *   sites in the Referer header.
 *
 * `script-src` keeps `'unsafe-inline'`. The framework streams its own bootstrap
 * and hydration scripts inline, and no nonce reaches them, so removing it would
 * break the site rather than harden it. That is the honest limit of this
 * policy: it does not stop injected script from running. What stops that is
 * React escaping everything by default and the one place that bypasses it
 * (db/markdown.ts) escaping first and emitting a fixed set of tags.
 */

const CSP = [
  "default-src 'self'",
  // Pretendard is served from jsdelivr; Turnstile runs the captcha.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net data:",
  // Uploads are served back through this origin; data: covers inline SVG marks.
  "img-src 'self' data: blob:",
  // Turnstile talks back to its own host while solving the challenge.
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const HEADERS: [string, string][] = [
  ["content-security-policy", CSP],
  ["strict-transport-security", "max-age=31536000; includeSubDomains; preload"],
  ["x-frame-options", "DENY"],
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  // None of these are used, so none of them are available to anything injected.
  ["permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"],
  ["cross-origin-opener-policy", "same-origin"],
  ["x-permitted-cross-domain-policies", "none"],
];

/** Pages that are about one person and must never sit in a shared cache. */
const PRIVATE = /^\/(me|control|admin|login)(\/|$)|^\/(review|store\/(licence|review))\//;

export function harden(response: Response, pathname: string): Response {
  // A streamed body must not be read here; copying the response preserves it.
  const out = new Response(response.body, response);
  for (const [name, value] of HEADERS) out.headers.set(name, value);

  if (PRIVATE.test(pathname)) {
    out.headers.set("cache-control", "private, no-store, max-age=0");
  }
  return out;
}
