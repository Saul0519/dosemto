/**
 * How often one caller may do something.
 *
 * Signing in with Discord already stops a stranger walking in, but it does not
 * stop one account holding the button down. These are the endpoints where doing
 * that costs something real — a hundred purchase requests, a flood of shop
 * applications, a review counter driven to nonsense.
 *
 * The caller is identified by their address, and the address is never stored:
 * only a keyed hash of it. The table can say "this bucket is full" and nothing
 * else. It cannot say who was in it, and it is no use to anyone who takes it.
 *
 * Limits are deliberately loose. A person doing the thing normally will never
 * see one; they exist for the case where something is hammering.
 */

export type Limit = { max: number; windowSeconds: number };

/** Buckets, chosen so ordinary use never reaches them. */
export const LIMITS = {
  purchase: { max: 10, windowSeconds: 3600 },
  review: { max: 30, windowSeconds: 3600 },
  apply: { max: 5, windowSeconds: 3600 },
  order: { max: 10, windowSeconds: 3600 },
  view: { max: 300, windowSeconds: 3600 },
  licenceTest: { max: 30, windowSeconds: 3600 },
  // A ledger page is a few dozen faces at once, and they are cached for a
  // day after. Only something walking made-up names reaches this.
  skin: { max: 600, windowSeconds: 3600 },
} satisfies Record<string, Limit>;

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

let migrateReady: Promise<void> | null = null;

async function ensureTable() {
  if (!migrateReady) {
    migrateReady = migrate().catch((error) => { migrateReady = null; throw error; });
  }
  return migrateReady;
}

async function migrate() {
  const db = await getD1();
  await db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    reset_at INTEGER NOT NULL
  )`).run();
}

/**
 * A short hash of who is calling, keyed with the site's own secret.
 *
 * Keyed so the table cannot be turned back into a list of addresses by anyone
 * who guesses at hashing plain ones — there are only four billion of them.
 */
async function who(request: Request, bucket: string) {
  const { env } = await import("cloudflare:workers");
  const address = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  const secret = typeof env.WEBHOOK_ENCRYPTION_KEY === "string" ? env.WEBHOOK_ENCRYPTION_KEY : "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`rate ${secret} ${bucket} ${address}`),
  );
  return [...new Uint8Array(digest).slice(0, 12)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Counts this call and says whether it is one too many.
 *
 * Fails open: if the counter itself cannot be read or written, the request goes
 * through. A database hiccup should not take the site down for everybody, and
 * the endpoints behind this are all guarded by something else as well.
 */
export async function tooMany(request: Request, name: keyof typeof LIMITS): Promise<boolean> {
  const limit = LIMITS[name];
  try {
    await ensureTable();
    const db = await getD1();
    const key = await who(request, name);
    const now = Math.floor(Date.now() / 1000);

    // One statement: start a fresh window, or add to the open one. Two calls
    // arriving together cannot both read zero and both write one.
    const row = await db.prepare(
      `INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET
         count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
       RETURNING count`,
    ).bind(key, now + limit.windowSeconds, now, now, now + limit.windowSeconds)
      .first<{ count: number }>();

    // Closed windows are dead weight. Swept now and then rather than on every
    // call, so the tidying never sits between a person and their answer.
    if (Math.random() < 0.01) await sweep(db, now).catch(() => undefined);

    return (row?.count ?? 0) > limit.max;
  } catch {
    return false;
  }
}

async function sweep(db: Awaited<ReturnType<typeof getD1>>, now: number) {
  await db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").bind(now).run();
}

/** The reply when someone is going too fast. */
export function slowDown() {
  return Response.json(
    { error: "너무 자주 시도했습니다. 잠시 후 다시 시도해 주세요." },
    { status: 429, headers: { "retry-after": "600" } },
  );
}
