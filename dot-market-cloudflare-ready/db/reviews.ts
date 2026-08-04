/**
 * Reviews are owned by the Discord account that placed the order.
 *
 * That single rule replaces the one-shot links this used to need: knowing an
 * order number is not enough, being signed in as its customer is. It also gives
 * the author something the old design could not — the ability to come back and
 * change or remove what they wrote. Shop managers can do neither.
 */

export type Review = {
  id: string;
  orderId: string;
  rating: number;
  body: string;
  /** Discord display name captured when the review was written. */
  displayName: string;
  createdAt: string;
  updatedAt: string;
  /** Set when the author attached a photo; the URL the page should render. */
  imageUrl: string | null;
};

export type ShopRating = {
  /** Mean rating to one decimal, 0 when there are none. */
  average: number;
  count: number;
  completedOrders: number;
};

/** The public URL for a review photo, keyed on the order it belongs to. */
function reviewImageUrl(orderId: string, imageKey: string | null) {
  return imageKey ? `/api/review-images/${encodeURIComponent(orderId)}` : null;
}

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("후기 데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

/**
 * Schema setup, once per isolate rather than once per query.
 *
 * Every helper in this file called this first, so a single page view replayed
 * the CREATEs and ALTERs dozens of times. Each statement is cheap on its own,
 * but each one is also a round trip to D1, and that is what the site felt like.
 * A failure clears the latch so the next request retries rather than running
 * against a half-built schema.
 */
let migrateReviewsTableReady: Promise<void> | null = null;

async function ensureReviewsTable() {
  if (!migrateReviewsTableReady) {
    migrateReviewsTableReady = migrateReviewsTable().catch((error) => { migrateReviewsTableReady = null; throw error; });
  }
  return migrateReviewsTableReady;
}

async function migrateReviewsTable() {
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
  await db.prepare("ALTER TABLE reviews ADD COLUMN author_mc_uuid TEXT").run().catch(() => undefined);
  await db.prepare("ALTER TABLE reviews ADD COLUMN updated_at TEXT").run().catch(() => undefined);
  // Optional photo of the finished work, stored in the bucket like shop images.
  await db.prepare("ALTER TABLE reviews ADD COLUMN image_key TEXT").run().catch(() => undefined);
}

export type ReviewableOrder = {
  orderId: string;
  shopId: string;
  shopName: string;
  shopSlug: string;
  tileCount: number;
  gridX: number;
  gridY: number;
  deadline: number;
  totalPrice: number;
  status: string;
  createdAt: string;
  ownerId: string | null;
};

/** Looks an order up by the number the customer sees on their profile. */
export async function getOrderForReview(orderId: string): Promise<ReviewableOrder | null> {
  await ensureReviewsTable();
  const db = await getD1();
  const row = await db.prepare(
    `SELECT o.id, o.shop_id, o.tile_count, o.grid_x, o.grid_y, o.deadline,
            o.total_price, o.status, o.created_at, o.player_uuid,
            s.name AS shop_name, s.slug AS shop_slug
       FROM orders o JOIN shops s ON s.id = o.shop_id WHERE o.id = ?`,
  ).bind(orderId).first<{
    id: string; shop_id: string; tile_count: number; grid_x: number; grid_y: number;
    deadline: number; total_price: number; status: string; created_at: string;
    player_uuid: string | null; shop_name: string; shop_slug: string;
  }>().catch(() => null);
  if (!row) return null;
  return {
    orderId: row.id,
    shopId: row.shop_id,
    shopName: row.shop_name,
    shopSlug: row.shop_slug,
    tileCount: row.tile_count,
    gridX: row.grid_x,
    gridY: row.grid_y,
    deadline: row.deadline,
    totalPrice: row.total_price,
    status: row.status,
    createdAt: row.created_at,
    ownerId: row.player_uuid,
  };
}

export async function getReviewForOrder(orderId: string): Promise<Review | null> {
  await ensureReviewsTable();
  const db = await getD1();
  const row = await db.prepare(
    `SELECT id, order_id, rating, body, display_name, created_at, updated_at, image_key
       FROM reviews WHERE order_id = ? AND status = 'visible'`,
  ).bind(orderId).first<{
    id: string; order_id: string; rating: number; body: string;
    display_name: string; created_at: string; updated_at: string | null;
    image_key: string | null;
  }>().catch(() => null);
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    rating: row.rating,
    body: row.body,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    imageUrl: reviewImageUrl(row.order_id, row.image_key),
  };
}

type Outcome = { ok: true } | { ok: false; error: string; status: number };

/**
 * Writes or rewrites the review for one order. Ownership is checked here rather
 * than by the caller so every entry point gets the same rule.
 */
export async function saveReview(input: {
  orderId: string;
  authorId: string;
  authorName: string;
  rating: number;
  body: string;
  /** A newly uploaded photo's object key, or undefined to leave the photo be. */
  imageKey?: string;
  /** True when the author asked for the existing photo to come off. */
  removeImage?: boolean;
}): Promise<Outcome> {
  const order = await getOrderForReview(input.orderId);
  if (!order) return { ok: false, error: "그런 주문번호가 없습니다.", status: 404 };
  if (order.ownerId !== input.authorId) {
    return { ok: false, error: "본인이 주문한 건에만 후기를 남길 수 있습니다.", status: 403 };
  }
  if (order.status !== "completed") {
    return { ok: false, error: "작업이 마감된 뒤에 후기를 남길 수 있습니다.", status: 409 };
  }

  const rating = Math.round(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "별점은 1점에서 5점 사이로 골라주세요.", status: 400 };
  }
  const body = input.body.trim().slice(0, 1000);

  const db = await getD1();
  const previousKey = await currentImageKey(input.orderId);

  // A replaced or removed photo has to leave the bucket too, or every edit
  // strands a file nothing points at.
  const nextKey = input.imageKey ?? (input.removeImage ? null : previousKey);
  if (previousKey && previousKey !== nextKey) await deleteStoredImage(previousKey);

  const existing = await getReviewForOrder(input.orderId);
  if (existing) {
    await db.prepare(
      `UPDATE reviews SET rating = ?, body = ?, display_name = ?, image_key = ?,
        updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND author_mc_uuid = ?`,
    ).bind(rating, body, input.authorName, nextKey, input.orderId, input.authorId).run();
    return { ok: true };
  }

  await db.prepare(
    `INSERT INTO reviews (id, order_id, shop_id, rating, body, display_name, author_mc_uuid, image_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).bind(crypto.randomUUID(), input.orderId, order.shopId, rating, body, input.authorName,
    input.authorId, nextKey).run();
  return { ok: true };
}

/** The stored photo for an order, whatever the review's visibility. */
export async function currentImageKey(orderId: string) {
  await ensureReviewsTable();
  const row = await getD1().then((db) => db.prepare(
    "SELECT image_key FROM reviews WHERE order_id = ?",
  ).bind(orderId).first<{ image_key: string | null }>()).catch(() => null);
  return row?.image_key ?? null;
}

/** Best effort: a file left behind is untidy, a failed request is worse. */
export async function deleteStoredImage(objectKey: string | null) {
  if (!objectKey) return;
  const { env } = await import("cloudflare:workers");
  await env.BUCKET?.delete(objectKey).catch(() => undefined);
}

/** The object key to serve for a review, only while it is publicly visible. */
export async function getVisibleReviewImageKey(orderId: string) {
  await ensureReviewsTable();
  const row = await getD1().then((db) => db.prepare(
    `SELECT r.image_key FROM reviews r JOIN shops s ON s.id = r.shop_id
      WHERE r.order_id = ? AND r.status = 'visible' AND s.active = 1`,
  ).bind(orderId).first<{ image_key: string | null }>()).catch(() => null);
  return row?.image_key ?? null;
}

/** Only the author can remove a review; a shop cannot delete a bad one. */
export async function deleteReview(orderId: string, authorId: string): Promise<Outcome> {
  await ensureReviewsTable();
  const db = await getD1();
  const imageKey = await currentImageKey(orderId);
  const removed = await db.prepare(
    "DELETE FROM reviews WHERE order_id = ? AND author_mc_uuid = ?",
  ).bind(orderId, authorId).run().catch(() => null);
  if (!removed?.meta.changes) {
    return { ok: false, error: "지울 후기를 찾지 못했습니다.", status: 404 };
  }
  await deleteStoredImage(imageKey);
  return { ok: true };
}

export async function listShopReviews(shopId: string, limit = 30): Promise<Review[]> {
  await ensureReviewsTable();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT id, order_id, rating, body, display_name, created_at, updated_at, image_key FROM reviews
      WHERE shop_id = ? AND status = 'visible' ORDER BY created_at DESC LIMIT ?`,
  ).bind(shopId, limit).all<{
    id: string; order_id: string; rating: number; body: string;
    display_name: string; created_at: string; updated_at: string | null;
    image_key: string | null;
  }>().catch(() => ({ results: [] }));
  return rows.results.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    rating: row.rating,
    body: row.body,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    imageUrl: reviewImageUrl(row.order_id, row.image_key),
  }));
}

/**
 * The completed-order count sits beside the rating on purpose. Ordering costs
 * nothing here, so a shop could review itself; showing both numbers at least
 * makes an implausible ratio visible.
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

/**
 * Moderation, for the site owner only.
 *
 * Hiding is the everyday tool: it is reversible and the shop page keeps showing
 * how many are hidden, so quietly burying criticism is visible rather than
 * silent. Purging exists for the cases where the content itself has to go —
 * personal information, say — and leaves nothing behind.
 */
export async function setReviewHidden(orderId: string, hidden: boolean): Promise<Outcome> {
  await ensureReviewsTable();
  const db = await getD1();
  const changed = await db.prepare(
    "UPDATE reviews SET status = ? WHERE order_id = ?",
  ).bind(hidden ? "hidden" : "visible", orderId).run().catch(() => null);
  if (!changed?.meta.changes) return { ok: false, error: "그 주문의 후기를 찾지 못했습니다.", status: 404 };
  return { ok: true };
}

export async function purgeReview(orderId: string): Promise<Outcome> {
  await ensureReviewsTable();
  const db = await getD1();
  const imageKey = await currentImageKey(orderId);
  const removed = await db.prepare("DELETE FROM reviews WHERE order_id = ?")
    .bind(orderId).run().catch(() => null);
  if (!removed?.meta.changes) return { ok: false, error: "그 주문의 후기를 찾지 못했습니다.", status: 404 };
  await deleteStoredImage(imageKey);
  return { ok: true };
}

export type ModeratedReview = Review & { shopName: string; hidden: boolean };

/** Every review across every shop, hidden ones included. Owner view. */
export async function listAllReviews(limit = 100): Promise<ModeratedReview[]> {
  await ensureReviewsTable();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT r.id, r.order_id, r.rating, r.body, r.display_name, r.created_at,
            r.updated_at, r.status, r.image_key, s.name AS shop_name
       FROM reviews r JOIN shops s ON s.id = r.shop_id
      ORDER BY r.created_at DESC LIMIT ?`,
  ).bind(limit).all<{
    id: string; order_id: string; rating: number; body: string; display_name: string;
    created_at: string; updated_at: string | null; status: string;
    image_key: string | null; shop_name: string;
  }>().catch(() => ({ results: [] }));
  return rows.results.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    rating: row.rating,
    body: row.body,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    imageUrl: reviewImageUrl(row.order_id, row.image_key),
    shopName: row.shop_name,
    hidden: row.status !== "visible",
  }));
}

/** How many of a shop's reviews the owner has hidden. Shown publicly. */
export async function countHiddenReviews(shopId: string) {
  await ensureReviewsTable();
  const row = await getD1().then((db) => db.prepare(
    "SELECT COUNT(*) AS count FROM reviews WHERE shop_id = ? AND status != 'visible'",
  ).bind(shopId).first<{ count: number }>()).catch(() => null);
  return row?.count ?? 0;
}

/**
 * Ratings for every shop at once.
 *
 * The market list needed a rating per shop and was asking for them one shop at
 * a time — two round trips each. Sorting by rating or review count needs the
 * same numbers, so both now come from these two grouped queries.
 */
export async function listShopRatings(): Promise<Map<string, ShopRating>> {
  await ensureReviewsTable();
  const db = await getD1();

  type RatingRow = { shop_id: string; average: number | null; count: number };
  type CountRow = { shop_id: string; count: number };

  const ratings = await db.prepare(
    `SELECT shop_id, AVG(rating) AS average, COUNT(*) AS count
       FROM reviews WHERE status = 'visible' GROUP BY shop_id`,
  ).all<RatingRow>().catch(() => ({ results: [] as RatingRow[] }));

  // Orders may not exist yet on a database that has never taken one.
  const completed = await db.prepare(
    "SELECT shop_id, COUNT(*) AS count FROM orders WHERE status = 'completed' GROUP BY shop_id",
  ).all<CountRow>().catch(() => ({ results: [] as CountRow[] }));

  const done = new Map<string, number>(
    completed.results.map((row) => [row.shop_id, row.count] as [string, number]),
  );
  const out = new Map<string, ShopRating>();
  for (const row of ratings.results) {
    out.set(row.shop_id, {
      average: row.average ? Math.round(row.average * 10) / 10 : 0,
      count: row.count,
      completedOrders: done.get(row.shop_id) ?? 0,
    });
  }
  // A shop with finished work but no reviews still belongs in the map.
  for (const [shopId, count] of done) {
    if (!out.has(shopId)) out.set(shopId, { average: 0, count: 0, completedOrders: count });
  }
  return out;
}
