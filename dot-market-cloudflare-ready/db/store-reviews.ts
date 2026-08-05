/**
 * Reviews of the things the store sells.
 *
 * A review hangs off one purchase, and the purchase's buyer is the only person
 * who can write it. Since a product is bought over and over, the review carries
 * how far into that history it was written: which purchase it was, and how long
 * the buyer has held the product in total. A first day's impression and a
 * regular's read differently, and the page should say which it is looking at.
 */

import { StorePurchase, getPurchaseByOrderNo } from "./store";
import { durationLabel, parseDurationDays } from "./store-plans";

export type StoreReview = {
  id: string;
  orderNo: string;
  itemId: string;
  rating: number;
  body: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  /** Which purchase of this product this was for them, counting from 1. */
  purchaseIndex: number;
  /** Total across their purchases of it, as a phrase — "1개월 8일", or "" when unknown. */
  heldFor: string;
};

export type ItemRating = { average: number; count: number; sold: number };

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("후기 데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

let migrateReady: Promise<void> | null = null;

async function ensureTables() {
  if (!migrateReady) {
    migrateReady = migrate().catch((error) => { migrateReady = null; throw error; });
  }
  return migrateReady;
}

async function migrate() {
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS store_reviews (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      item_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      author_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS store_reviews_item_idx ON store_reviews (item_id, created_at DESC)"),
  ]);
}

type ReviewRow = {
  id: string; order_no: string; item_id: string; rating: number; body: string;
  display_name: string; created_at: string; updated_at: string | null; status: string;
};

type Outcome = { ok: true } | { ok: false; error: string; status: number };

/**
 * A purchase can be reviewed once the owner has marked it handed over. Before
 * that there is nothing to have an opinion about yet.
 */
export function reviewableReason(purchase: StorePurchase | null, authorId: string): Outcome {
  if (!purchase) return { ok: false, error: "그런 주문번호가 없습니다.", status: 404 };
  if (purchase.buyerId !== authorId) {
    return { ok: false, error: "본인이 구매한 건에만 후기를 남길 수 있습니다.", status: 403 };
  }
  if (!purchase.handled) {
    return { ok: false, error: "상품을 받은 뒤에 후기를 남길 수 있습니다.", status: 409 };
  }
  // A review needs a product page to sit on. Deleted, switched off, or with no
  // plan left, there is nowhere to put it.
  if (!purchase.itemExists) {
    return { ok: false, error: "지금은 판매하지 않는 상품이라 후기를 남길 수 없습니다.", status: 410 };
  }
  return { ok: true };
}

export async function getReviewForPurchase(orderNo: string): Promise<StoreReview | null> {
  await ensureTables();
  const db = await getD1();
  const row = await db.prepare(
    `SELECT id, order_no, item_id, rating, body, display_name, created_at, updated_at, status
       FROM store_reviews WHERE order_no = ?`,
  ).bind(orderNo).first<ReviewRow>().catch(() => null);
  if (!row) return null;
  return {
    id: row.id,
    orderNo: row.order_no,
    itemId: row.item_id,
    rating: row.rating,
    body: row.body,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    purchaseIndex: 0,
    heldFor: "",
  };
}

export async function saveReview(input: {
  orderNo: string;
  authorId: string;
  authorName: string;
  rating: number;
  body: string;
}): Promise<Outcome> {
  await ensureTables();
  const purchase = await getPurchaseByOrderNo(input.orderNo);
  const allowed = reviewableReason(purchase, input.authorId);
  if (!allowed.ok) return allowed;

  const rating = Math.round(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "별점은 1점에서 5점 사이로 골라주세요.", status: 400 };
  }
  const body = input.body.trim().slice(0, 1000);

  const db = await getD1();
  const existing = await getReviewForPurchase(purchase!.orderNo);
  if (existing) {
    await db.prepare(
      `UPDATE store_reviews SET rating = ?, body = ?, display_name = ?,
        updated_at = CURRENT_TIMESTAMP WHERE order_no = ? AND author_id = ?`,
    ).bind(rating, body, input.authorName, purchase!.orderNo, input.authorId).run();
    return { ok: true };
  }

  await db.prepare(
    `INSERT INTO store_reviews (id, order_no, item_id, rating, body, display_name, author_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).bind(crypto.randomUUID(), purchase!.orderNo, purchase!.itemId, rating, body,
    input.authorName, input.authorId).run();
  return { ok: true };
}

/** Only the author can take their own review down. */
export async function deleteReview(orderNo: string, authorId: string): Promise<Outcome> {
  await ensureTables();
  const db = await getD1();
  const removed = await db.prepare(
    "DELETE FROM store_reviews WHERE order_no = ? AND author_id = ?",
  ).bind(orderNo, authorId).run().catch(() => null);
  if (!removed?.meta.changes) return { ok: false, error: "지울 후기를 찾지 못했습니다.", status: 404 };
  return { ok: true };
}

type HistoryRow = { order_no: string; buyer_id: string; plan_label: string; created_at: string };

/**
 * How much of the product each reviewer had bought.
 *
 * Read in one pass over the item's handed-over purchases rather than a query
 * per review. The index counts only up to the reviewed purchase, so an old
 * review keeps saying "2번째"; the total is everything they have ever bought,
 * because that is what "얼마나 오래 써봤는지" means when reading it today.
 */
async function buyerHistory(itemId: string) {
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT order_no, buyer_id, plan_label, created_at FROM store_purchases
      WHERE item_id = ? AND status = 'handled' ORDER BY created_at ASC`,
  ).bind(itemId).all<HistoryRow>().catch(() => ({ results: [] as HistoryRow[] }));

  const indexByOrder = new Map<string, number>();
  const daysByBuyer = new Map<string, number>();
  const countByBuyer = new Map<string, number>();
  for (const row of rows.results) {
    if (!row.order_no) continue;
    const nth = (countByBuyer.get(row.buyer_id) ?? 0) + 1;
    countByBuyer.set(row.buyer_id, nth);
    indexByOrder.set(row.order_no, nth);
    daysByBuyer.set(row.buyer_id, (daysByBuyer.get(row.buyer_id) ?? 0) + parseDurationDays(row.plan_label));
  }
  const buyerByOrder = new Map<string, string>(
    rows.results.map((row: HistoryRow) => [row.order_no, row.buyer_id] as [string, string]),
  );
  return { indexByOrder, daysByBuyer, buyerByOrder };
}

export async function listItemReviews(itemId: string, limit = 30): Promise<StoreReview[]> {
  await ensureTables();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT id, order_no, item_id, rating, body, display_name, created_at, updated_at, status
       FROM store_reviews WHERE item_id = ? AND status = 'visible'
       ORDER BY created_at DESC LIMIT ?`,
  ).bind(itemId, limit).all<ReviewRow>().catch(() => ({ results: [] as ReviewRow[] }));
  if (rows.results.length === 0) return [];

  const history = await buyerHistory(itemId);
  return rows.results.map((row: ReviewRow) => {
    const buyerId = history.buyerByOrder.get(row.order_no);
    const days = buyerId ? history.daysByBuyer.get(buyerId) ?? 0 : 0;
    return {
      id: row.id,
      orderNo: row.order_no,
      itemId: row.item_id,
      rating: row.rating,
      body: row.body,
      displayName: row.display_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
      purchaseIndex: history.indexByOrder.get(row.order_no) ?? 0,
      heldFor: durationLabel(days),
    };
  });
}

export async function getItemRating(itemId: string): Promise<ItemRating> {
  await ensureTables();
  const db = await getD1();
  const rating = await db.prepare(
    "SELECT AVG(rating) AS average, COUNT(*) AS count FROM store_reviews WHERE item_id = ? AND status = 'visible'",
  ).bind(itemId).first<{ average: number | null; count: number }>().catch(() => null);
  const sold = await db.prepare(
    "SELECT COUNT(*) AS count FROM store_purchases WHERE item_id = ? AND status = 'handled'",
  ).bind(itemId).first<{ count: number }>().catch(() => null);
  return {
    average: rating?.average ? Math.round(rating.average * 10) / 10 : 0,
    count: rating?.count ?? 0,
    sold: sold?.count ?? 0,
  };
}

/** Ratings for every product at once, so the grid does not query per card. */
export async function listItemRatings(): Promise<Map<string, ItemRating>> {
  await ensureTables();
  const db = await getD1();
  type Row = { item_id: string; average: number | null; count: number };
  type SoldRow = { item_id: string; count: number };

  const ratings = await db.prepare(
    `SELECT item_id, AVG(rating) AS average, COUNT(*) AS count
       FROM store_reviews WHERE status = 'visible' GROUP BY item_id`,
  ).all<Row>().catch(() => ({ results: [] as Row[] }));
  const sold = await db.prepare(
    "SELECT item_id, COUNT(*) AS count FROM store_purchases WHERE status = 'handled' GROUP BY item_id",
  ).all<SoldRow>().catch(() => ({ results: [] as SoldRow[] }));

  const soldBy = new Map<string, number>(
    sold.results
      .filter((row: SoldRow) => Boolean(row.item_id))
      .map((row: SoldRow) => [row.item_id, row.count] as [string, number]),
  );
  const out = new Map<string, ItemRating>();
  for (const row of ratings.results as Row[]) {
    out.set(row.item_id, {
      average: row.average ? Math.round(row.average * 10) / 10 : 0,
      count: row.count,
      sold: soldBy.get(row.item_id) ?? 0,
    });
  }
  for (const [itemId, count] of soldBy) {
    if (!out.has(itemId)) out.set(itemId, { average: 0, count: 0, sold: count });
  }
  return out;
}

export type ModeratedStoreReview = StoreReview & { itemName: string; hidden: boolean };

/** Every store review, hidden ones included. Owner view. */
export async function listAllReviews(limit = 100): Promise<ModeratedStoreReview[]> {
  await ensureTables();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT r.id, r.order_no, r.item_id, r.rating, r.body, r.display_name,
            r.created_at, r.updated_at, r.status,
            COALESCE(i.name, '지워진 상품') AS item_name
       FROM store_reviews r LEFT JOIN store_items i ON i.id = r.item_id
      ORDER BY r.created_at DESC LIMIT ?`,
  ).bind(limit).all<ReviewRow & { item_name: string }>().catch(() => ({ results: [] as (ReviewRow & { item_name: string })[] }));
  return rows.results.map((row) => ({
    id: row.id,
    orderNo: row.order_no,
    itemId: row.item_id,
    rating: row.rating,
    body: row.body,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    purchaseIndex: 0,
    heldFor: "",
    itemName: row.item_name,
    hidden: row.status !== "visible",
  }));
}

export async function setReviewHidden(orderNo: string, hidden: boolean): Promise<Outcome> {
  await ensureTables();
  const db = await getD1();
  const changed = await db.prepare("UPDATE store_reviews SET status = ? WHERE order_no = ?")
    .bind(hidden ? "hidden" : "visible", orderNo).run().catch(() => null);
  if (!changed?.meta.changes) return { ok: false, error: "그 주문의 후기를 찾지 못했습니다.", status: 404 };
  return { ok: true };
}

export async function purgeReview(orderNo: string): Promise<Outcome> {
  await ensureTables();
  const db = await getD1();
  const removed = await db.prepare("DELETE FROM store_reviews WHERE order_no = ?")
    .bind(orderNo).run().catch(() => null);
  if (!removed?.meta.changes) return { ok: false, error: "그 주문의 후기를 찾지 못했습니다.", status: 404 };
  return { ok: true };
}
