/**
 * Reading the licence server's list, to know how many slots are taken.
 *
 * The store does not issue licences — a separate worker does. This reads what
 * it has issued so slots fill on their own as keys go out, rather than the
 * owner keeping two places in step by hand.
 *
 * Counting happens here, not there. Its own slot limit ships switched off, and
 * the product's limit lives with the product because different products will
 * want different numbers. Turning both on would mean two tallies that disagree.
 *
 * Codes come back masked — the licence server will not hand out whole keys,
 * because an unbound code belongs to whoever types it first. So the exempt list
 * is matched by masking our copy the same way rather than by comparing keys.
 */

/** Long enough that a burst of page views is one request, short enough to feel live. */
const CACHE_MS = 60 * 1000;

/** Only these hold a slot. An expired or suspended key frees its place. */
const LIVE_STATES = new Set(["미사용", "사용중"]);

export type LicenceRow = {
  /** Masked: first six characters, then bullets. */
  code: string;
  state: string;
  /** Set when the licence server itself marked the key exempt. */
  exempt: boolean;
};

export type LicenceList = {
  rows: LicenceRow[];
  /** True when the server could not be read and these are the last known rows. */
  stale: boolean;
  /** False when no licence server is set, so slots never fill on their own. */
  configured: boolean;
};

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

let cached: { at: number; rows: LicenceRow[] } | null = null;

export async function getLicenceServer() {
  const [url, token] = await Promise.all([meta("licence_url"), meta("licence_token")]);
  return { url, hasToken: token.length > 0 };
}

export async function setLicenceServer(url: string, token: string | null) {
  const db = await getD1();
  await db.prepare("CREATE TABLE IF NOT EXISTS site_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await db.prepare("INSERT OR REPLACE INTO site_meta (key, value) VALUES ('licence_url', ?)")
    .bind(url.trim()).run();
  // A null token means "leave what is there", so editing the address cannot
  // silently wipe the secret.
  if (token !== null) {
    await db.prepare("INSERT OR REPLACE INTO site_meta (key, value) VALUES ('licence_token', ?)")
      .bind(token.trim()).run();
  }
  cached = null;
}

/**
 * The same masking the licence server applies before it hands a list over:
 * first six characters, the rest replaced.
 */
export function maskKey(key: string) {
  const clean = key.trim().toUpperCase();
  if (clean.length <= 6) return clean;
  return clean.slice(0, 6) + "•".repeat(clean.length - 6);
}

/** Pulls the rows out, tolerating a bare array as well as the documented wrapper. */
export function readRows(payload: unknown): LicenceRow[] | null {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? (["rows", "licences", "licenses", "items", "results", "data"] as const)
        .map((field) => (payload as Record<string, unknown>)[field])
        .find(Array.isArray)
      : null;
  if (!Array.isArray(list)) return null;

  return list.map((entry) => {
    if (typeof entry === "string") return { code: entry, state: "사용중", exempt: false };
    const row = (entry ?? {}) as Record<string, unknown>;
    const code = ["code", "key", "licence", "license"]
      .map((field) => row[field])
      .find((value): value is string => typeof value === "string");
    return {
      code: code ?? "",
      // No state field means the server does not track expiry; count it as live.
      state: typeof row.state === "string" ? row.state : "사용중",
      exempt: row.exempt === true,
    };
  }).filter((row) => row.code.length > 0);
}

export async function fetchLicences(): Promise<LicenceList> {
  const { url } = await getLicenceServer();
  if (!url) return { rows: [], stale: false, configured: false };

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return { rows: cached.rows, stale: false, configured: true };
  }

  const token = await meta("licence_token");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  }).catch(() => null);

  const payload = response?.ok ? await response.json().catch(() => null) : null;
  const rows = readRows(payload);
  if (!rows) {
    // Unreachable, refused, or an answer we did not understand. Saying so beats
    // reporting zero, which reads as "plenty of room left".
    return { rows: cached?.rows ?? [], stale: true, configured: true };
  }

  cached = { at: Date.now(), rows };
  return { rows, stale: false, configured: true };
}

/**
 * How many of these hold a slot.
 *
 * Expired and suspended keys are out — the licence server frees their place, so
 * counting them would keep a product shut after its holders had gone. The
 * exempt list is the store's; a key the licence server has already flagged is
 * skipped too, since either way the owner has said it should not count.
 */
export function countLive(rows: LicenceRow[], exemptKeys: string[]) {
  const skip = new Set(exemptKeys.map(maskKey));
  return rows.filter((row) => LIVE_STATES.has(row.state))
    .filter((row) => !row.exempt && !skip.has(maskKey(row.code)))
    .length;
}

/** Forces the next read to go out to the server. */
export function forgetLicenceCache() {
  cached = null;
}
