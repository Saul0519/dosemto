/**
 * One-shot links that let a shop act on an order straight from the Discord
 * notification, and let the customer leave a review once it is finished.
 *
 * The link is the whole authorisation. Anyone reading the shop's Discord
 * channel can see the URL, so tokens are single use and only ever stored as a
 * SHA-256 hash — a leaked database row cannot be replayed as a link.
 */

export const ORDER_ACTIONS = ["accept", "reject", "complete"] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

export const ACTION_LABELS: Record<OrderAction, string> = {
  accept: "주문 확인",
  reject: "주문 거절",
  complete: "마감 완료",
};

// The status each action moves the order to. Mirrors db/orders.ts OrderStatus.
export const ACTION_STATUS: Record<OrderAction, "working" | "cancelled" | "completed"> = {
  accept: "working",
  reject: "cancelled",
  complete: "completed",
};

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("주문 데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

// Unambiguous alphabet: no O/0, I/1, so a token can be read aloud or retyped.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomToken(length = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  // Rejection-free: 256 % 31 != 0 skews slightly, but the alphabet is small and
  // the token is long, so the residual bias costs well under one bit overall.
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ensureActionTables() {
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS order_actions (
      token_hash TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      action TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS order_actions_order_idx ON order_actions (order_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS review_tokens (
      token_hash TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      unlocked_at TEXT,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);
}

/** Issues the three action links plus the (still locked) review link. */
export async function issueOrderTokens(orderId: string) {
  await ensureActionTables();
  const db = await getD1();

  const actions = ORDER_ACTIONS.map((action) => ({ action, token: randomToken() }));
  const review = randomToken();

  const statements = await Promise.all([
    ...actions.map(async ({ action, token }) =>
      db.prepare("INSERT INTO order_actions (token_hash, order_id, action) VALUES (?, ?, ?)")
        .bind(await hashToken(token), orderId, action),
    ),
    db.prepare("INSERT OR REPLACE INTO review_tokens (token_hash, order_id) VALUES (?, ?)")
      .bind(await hashToken(review), orderId),
  ]);
  await db.batch(statements);

  return {
    actions: Object.fromEntries(actions.map(({ action, token }) => [action, token])) as Record<OrderAction, string>,
    review,
  };
}

export type ActionLookup = {
  orderId: string;
  action: OrderAction;
  usedAt: string | null;
  shopId: string;
  shopName: string;
  shopSlug: string;
  status: string;
  tileCount: number;
  gridX: number;
  gridY: number;
  deadline: number;
  totalPrice: number;
  contact: string;
  createdAt: string;
};

export async function lookupAction(token: string): Promise<ActionLookup | null> {
  await ensureActionTables();
  const db = await getD1();
  const row = await db.prepare(`SELECT a.order_id, a.action, a.used_at,
      o.shop_id, o.status, o.tile_count, o.grid_x, o.grid_y, o.deadline,
      o.total_price, o.contact, o.created_at,
      s.name AS shop_name, s.slug AS shop_slug
    FROM order_actions a
    JOIN orders o ON o.id = a.order_id
    JOIN shops s ON s.id = o.shop_id
    WHERE a.token_hash = ?`).bind(await hashToken(token)).first<{
      order_id: string; action: OrderAction; used_at: string | null;
      shop_id: string; status: string; tile_count: number; grid_x: number;
      grid_y: number; deadline: number; total_price: number; contact: string;
      created_at: string; shop_name: string; shop_slug: string;
    }>();
  if (!row) return null;
  return {
    orderId: row.order_id,
    action: row.action,
    usedAt: row.used_at,
    shopId: row.shop_id,
    shopName: row.shop_name,
    shopSlug: row.shop_slug,
    status: row.status,
    tileCount: row.tile_count,
    gridX: row.grid_x,
    gridY: row.grid_y,
    deadline: row.deadline,
    totalPrice: row.total_price,
    contact: row.contact,
    createdAt: row.created_at,
  };
}

/**
 * Burns the token and applies the status change in one conditional UPDATE, so a
 * double-tap on a phone cannot run the action twice.
 * Returns null when the token was already spent.
 */
export async function consumeAction(token: string) {
  const found = await lookupAction(token);
  if (!found || found.usedAt) return null;

  const db = await getD1();
  const burn = await db.prepare(
    "UPDATE order_actions SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND used_at IS NULL",
  ).bind(await hashToken(token)).run();
  if (!burn.meta.changes) return null;

  const status = ACTION_STATUS[found.action];
  await db.prepare("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(status, found.orderId).run();

  // Finishing an order is what lets the customer review it.
  if (found.action === "complete") {
    await db.prepare(
      "UPDATE review_tokens SET unlocked_at = CURRENT_TIMESTAMP WHERE order_id = ? AND unlocked_at IS NULL",
    ).bind(found.orderId).run();
  }

  return { ...found, status };
}
