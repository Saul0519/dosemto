import { slowDown, tooMany } from "../../../../db/rate-limit";

/**
 * A player's head, served from this origin.
 *
 * The picture comes from a public skin service, but the browser never talks to
 * that service. Two reasons: the content security policy only allows images
 * from here, and a third party should not get a log of who looked at which
 * order and when just because a head appeared on the page.
 *
 * Never fails. A name with no account behind it — which is most of them on a
 * server that does not check with Mojang — gets a drawn stand-in instead of a
 * broken image.
 *
 * Anyone can call this, so it is capped. Each new name costs a call out to
 * somebody else's service, and a script walking made-up names would miss the
 * cache every time and spend their capacity rather than ours.
 */

const SOURCE = (nick: string) => `https://mc-heads.net/avatar/${nick}/64`;

/** Minecraft names: letters, digits and underscore, up to sixteen. */
const NAME = /^[A-Za-z0-9_]{1,16}$/;

/**
 * Only formats that cannot carry script.
 *
 * `image/svg+xml` is the one being kept out. An SVG can hold a `<script>`, and
 * a document served from this origin runs under this origin's policy — which
 * still allows inline script, because the framework needs it. Opened in a tab
 * rather than an `<img>`, that would be somebody else's code running here.
 */
const SAFE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** A day for a real head; a minute for a stand-in, since it may be temporary. */
const CACHE_HIT = "public, max-age=86400, stale-while-revalidate=604800";
const CACHE_MISS = "public, max-age=60";

/** Long enough for a slow answer, short enough not to hold a request open. */
const TIMEOUT_MS = 4000;

/**
 * The stand-in: the first letter on a colour picked from the name, so the same
 * player is always the same colour and two players rarely collide.
 */
function drawn(nick: string) {
  let hash = 0;
  for (const character of nick) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  const letter = nick.slice(0, 1).toUpperCase().replace(/[<&>]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`
    + `<rect width="64" height="64" fill="hsl(${hash} 42% 62%)"/>`
    + `<text x="32" y="43" text-anchor="middle" font-family="system-ui, sans-serif"`
    + ` font-size="32" font-weight="700" fill="rgba(255,255,255,.92)">${letter}</text></svg>`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": CACHE_MISS,
      ...LOCKED_DOWN,
    },
  });
}

/**
 * This response is a picture and nothing else, whatever it turns out to hold.
 * Applied to both paths, so neither the drawn stand-in nor a proxied body can
 * do anything if it is ever opened directly rather than in an `<img>`.
 */
const LOCKED_DOWN = {
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "x-content-type-options": "nosniff",
  "content-disposition": "inline",
};

export async function GET(request: Request, context: { params: Promise<{ nick: string }> }) {
  const { nick } = await context.params;
  if (!NAME.test(nick)) return drawn("?");
  if (await tooMany(request, "skin")) return slowDown();

  const response = await fetch(SOURCE(nick), {
    // A redirect could land anywhere, and anywhere is not a skin service.
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Cloudflare keeps the answer, so a busy page is one call rather than fifty.
    cf: { cacheTtl: 86400, cacheEverything: true },
  } as RequestInit).catch(() => null);

  if (!response?.ok) return drawn(nick);

  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!SAFE_TYPES.has(type)) return drawn(nick);

  return new Response(response.body, {
    headers: { "content-type": type, "cache-control": CACHE_HIT, ...LOCKED_DOWN },
  });
}
