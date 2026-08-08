/**
 * Asking the licence server how many keys are live.
 *
 * The store does not issue licences — a separate worker does. This reads the
 * count from there so slots fill on their own as keys are handed out, rather
 * than the owner having to keep two places in step by hand.
 *
 * Both the address and the shared secret live in site_meta, so pointing this
 * somewhere else or switching it off is a change in the panel, not a deploy.
 * With no address set the whole thing is off and nothing is ever fetched.
 */

/** Long enough that a burst of page views is one request, short enough to feel live. */
const CACHE_MS = 60 * 1000;

export type LicenceCount = {
  /** Keys the server reports, before the exempt list is applied. */
  keys: string[];
  /** True when the server could not be reached and this is the last known list. */
  stale: boolean;
  /** Null when no licence server is configured. */
  configured: boolean;
};

let cached: { at: number; keys: string[] } | null = null;

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

async function meta(key: string) {
  const db = await getD1();
  await db.prepare("CREATE TABLE IF NOT EXISTS site_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const row = await db.prepare("SELECT value FROM site_meta WHERE key = ?")
    .bind(key).first<{ value: string }>().catch(() => null);
  return row?.value ?? "";
}

export async function getLicenceServer() {
  const [url, token] = await Promise.all([meta("licence_url"), meta("licence_token")]);
  return { url, hasToken: token.length > 0 };
}

export async function setLicenceServer(url: string, token: string | null) {
  const db = await getD1();
  await db.prepare("CREATE TABLE IF NOT EXISTS site_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await db.prepare("INSERT OR REPLACE INTO site_meta (key, value) VALUES ('licence_url', ?)")
    .bind(url.trim()).run();
  // A null token means "leave what is there"; the panel never sends it back,
  // so editing the address cannot silently wipe the secret.
  if (token !== null) {
    await db.prepare("INSERT OR REPLACE INTO site_meta (key, value) VALUES ('licence_token', ?)")
      .bind(token.trim()).run();
  }
  cached = null;
}

/**
 * Pulls out the licence keys whatever shape the answer takes.
 *
 * The licence worker is the owner's own and may well change; accepting a few
 * reasonable shapes costs little and saves a deploy here every time it does.
 */
export function readKeys(payload: unknown): string[] | null {
  const fromEntry = (entry: unknown): string | null => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") {
      const row = entry as Record<string, unknown>;
      for (const field of ["key", "licence", "license", "code", "licenceKey", "licenseKey"]) {
        if (typeof row[field] === "string") return row[field] as string;
      }
    }
    return null;
  };

  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? (["licences", "licenses", "keys", "items", "results", "data"] as const)
        .map((field) => (payload as Record<string, unknown>)[field])
        .find(Array.isArray)
      : null;
  if (!Array.isArray(list)) return null;

  return list.map(fromEntry).filter((key): key is string => Boolean(key));
}

export async function fetchLicenceKeys(): Promise<LicenceCount> {
  const { url } = await getLicenceServer();
  if (!url) return { keys: [], stale: false, configured: false };

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return { keys: cached.keys, stale: false, configured: true };
  }

  const token = await meta("licence_token");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}`, "x-licence-token": token } : {}),
    },
  }).catch(() => null);

  const payload = response?.ok ? await response.json().catch(() => null) : null;
  const keys = readKeys(payload);
  if (!keys) {
    // Unreachable, refused, or an answer we did not understand. Say so rather
    // than reporting zero, which would look like "plenty of room left".
    return { keys: cached?.keys ?? [], stale: true, configured: true };
  }

  cached = { at: Date.now(), keys };
  return { keys, stale: false, configured: true };
}

/** Forces the next read to go out to the server. */
export function forgetLicenceCache() {
  cached = null;
}
