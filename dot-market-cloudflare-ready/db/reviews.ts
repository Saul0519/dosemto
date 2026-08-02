import { hashToken } from "./order-actions";

export type Review = {
  id: string;
  orderId: string;
  rating: number;
  body: string;
  /** The Minecraft account name the reviewer signed in with. */
  displayName: string;
  createdAt: string;
};

export type ShopRating = {
  average: number;
  count: number;
  /** Completed orders, for context next to the review count. */
  completedOrders: number;
};

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("후기 데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

export async function ensureReviewsTable() {
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      shop_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS reviews_shop_idx ON reviews (shop_id, created_at DESC)"),
  ]);

  // The reviewer's verified Minecraft identity, added after the table shipped.
  await db.prepare("ALTER TABLE reviews ADD COLUMN author_mc_uuid TEXT").run().catch(() => undefined);
}

export type ReviewInvite = {
  orderId: string;
  shopId: string;
  shopName: string;
  shopSlug: string;
  tileCount: number;
  deadline: number;
  createdAt: string;
  /** null until the shop marks the order complete. */
  unlockedAt: string | null;
  usedAt: string | null;
};

export async function lookupReviewToken(token: string): Promise<ReviewInvite | null> {
  await ensureReviewsTable();
  const db = await getD1();
  const row = await db.prepare(`SELECT t.order_id, t.unlocked_at, t.used_at,
      o.shop_id, o.tile_count, o.deadline, o.created_at,
      s.name AS shop_name, s.slug AS shop_slug
    FROM review_tokens t
    JOIN orders o ON o.id = t.order_id
    JOIN shops s ON s.id = o.shop_id
    WHERE t.token_hash = ?`).bind(await hashToken(token)).first<{
      order_id: string; unlocked_at: string | null; used_at: string | null;
      shop_id: string; tile_count: number; deadline: number; created_at: string;
      shop_name: string; shop_slug: string;
    }>().catch(() => null);
  if (!row) return null;
  return {
    orderId: row.order_id,
    shopId: row.shop_id,
    shopName: row.shop_name,
    shopSlug: row.shop_slug,
    tileCount: row.tile_count,
    deadline: row.deadline,
    createdAt: row.created_at,
    unlockedAt: row.unlocked_at,
    usedAt: row.used_at,
  };
}

/**
 * Writes the review and burns the token in one conditional UPDATE, so a double
 * submit cannot produce two reviews for the same order.
 */
export async function submitReview(token: string, input: {
  rating: number;
  body: string;
  /** Taken from the signed Minecraft session, never from the form. */
  player: { uuid: string; name: string };
}) {
  const invite = await lookupReviewToken(token);
  if (!invite) return { ok: false as const, error: "쓸 수 없는 링크입니다." };
  if (!invite.unlockedAt) {
    return { ok: false as const, error: "아직 마감 처리되지 않은 주문입니다. 작업이 끝나면 후기를 남길 수 있습니다." };
  }
  if (invite.usedAt) return { ok: false as const, error: "이미 후기를 남긴 주문입니다." };

  const rating = Math.round(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false as const, error: "별점은 1점에서 5점 사이로 골라주세요." };
  }
  const body = input.body.trim().slice(0, 1000);

  const db = await getD1();
  const burn = await db.prepare(
    "UPDATE review_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND used_at IS NULL AND unlocked_at IS NOT NULL",
  ).bind(await hashToken(token)).run();
  if (!burn.meta.changes) return { ok: false as const, error: "이미 후기를 남긴 주문입니다." };

  await db.prepare(
    "INSERT INTO reviews (id, order_id, shop_id, rating, body, display_name, author_mc_uuid) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), invite.orderId, invite.shopId, rating, body, input.player.name, input.player.uuid).run();

  return { ok: true as const, shopSlug: invite.shopSlug, shopName: invite.shopName };
}

export async function listShopReviews(shopId: string, limit = 20): Promise<Review[]> {
  await ensureReviewsTable();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT id, order_id, rating, body, display_name, created_at FROM reviews
     WHERE shop_id = ? AND status = 'visible' ORDER BY created_at DESC LIMIT ?`,
  ).bind(shopId, limit).all<{
    id: string; order_id: string; rating: number; body: string;
    display_name: string; created_at: string;
  }>().catch(() => ({ results: [] }));
  return rows.results.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    rating: row.rating,
    body: row.body,
    displayName: row.display_name,
    createdAt: row.created_at,
  }));
}

/**
 * The order count sits next to the rating on purpose. There is no payment step,
 * so nothing stops a shop from ordering from itself; showing both numbers lets
 * a reader judge whether the ratio looks plausible.
 */
export async function getShopRating(shopId: string): Promise<ShopRating> {
  await ensureReviewsTable();
  const db = await getD1();
  const rating = await db.prepare(
    "SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE shop_id = ? AND status = 'visible'",
  ).bind(shopId).first<{ average: number | null; count: number }>().catch(() => null);
  const orders = await db.prepare(
    "SELECT COUNT(*) AS count FROM orders WHERE shop_id = ? AND status = 'completed'",
  ).bind(shopId).first<{ count: number }>().catch(() => null);

  return {
    average: rating?.average ? Math.round(rating.average * 10) / 10 : 0,
    count: rating?.count ?? 0,
    completedOrders: orders?.count ?? 0,
  };
}
