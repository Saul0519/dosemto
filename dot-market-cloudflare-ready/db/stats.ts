/**
 * The numbers that say whether the site is working.
 *
 * Almost everything here is counted from rows that already exist — orders,
 * reviews, purchases — so no new tracking was needed for it. The one exception
 * is page views, which nothing records on its own; those are kept as a plain
 * per-day tally with no visitor attached, because the only question worth
 * asking is "how many people looked and did not order", not who they were.
 *
 * Days are bucketed in KST rather than UTC so "오늘" on the screen means the
 * day the owner is actually having.
 */

const KST = "+9 hours";

/** Only these can be counted, so a stray request cannot invent a metric. */
export const VIEW_EVENTS = ["home", "shop", "store", "store_item"] as const;
export type ViewEvent = typeof VIEW_EVENTS[number];

export type Period = 7 | 30 | 0;

export type DayCount = { day: string; count: number };

export type ShopStats = {
  name: string;
  slug: string;
  orders: number;
  completed: number;
  cancelled: number;
  revenue: number;
  reviews: number;
  rating: number;
};

export type ItemStats = { name: string; requests: number; handled: number; revenue: number };

export type Stats = {
  orders: { total: number; open: number; completed: number; cancelled: number; revenue: number };
  /** Views of a shop page against orders actually placed there. */
  funnel: { shopViews: number; orders: number; storeViews: number; purchases: number };
  reviews: { count: number; rating: number; storeCount: number; storeRating: number };
  store: { requests: number; handled: number; revenue: number };
  applications: { waiting: number; total: number };
  byDay: DayCount[];
  byShop: ShopStats[];
  byItem: ItemStats[];
};

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
  // One row per day per kind. No visitor, no address, nothing to join back to a
  // person — the table cannot answer "who", only "how many".
  await db.prepare(`CREATE TABLE IF NOT EXISTS site_views (
    day TEXT NOT NULL,
    event TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, event)
  )`).run();
}

export async function countView(event: string) {
  if (!(VIEW_EVENTS as readonly string[]).includes(event)) return false;
  await ensureTable();
  const db = await getD1();
  await db.prepare(
    `INSERT INTO site_views (day, event, count) VALUES (date('now', ?), ?, 1)
     ON CONFLICT(day, event) DO UPDATE SET count = count + 1`,
  ).bind(KST, event).run();
  return true;
}

/** SQLite understands this directly, so no dates are computed in the worker. */
const since = (period: Period) => (period === 0 ? "-100 years" : `-${period} days`);

export async function readStats(period: Period): Promise<Stats> {
  await ensureTable();
  const db = await getD1();
  const cutoff = since(period);

  type StatusRow = { status: string; count: number; revenue: number | null };
  type DayRow = { day: string; count: number };
  type ShopRow = {
    name: string; slug: string; orders: number; completed: number;
    cancelled: number; revenue: number | null;
  };
  type RatingRow = { slug: string; count: number; average: number | null };
  type ViewRow = { event: string; count: number };
  type StoreRow = { requests: number; handled: number; revenue: number | null };
  type ItemRow = { name: string; requests: number; handled: number; revenue: number | null };
  type PairRow = { count: number; average: number | null };
  type CountRow = { waiting: number; total: number };

  const empty = <T>() => ({ results: [] as T[] });

  const [statuses, byDay, shops, ratings, views, storeRaw, items, storeReviewsRaw, applicationsRaw] =
    await Promise.all([
      db.prepare(
        `SELECT status, COUNT(*) AS count, SUM(total_price) AS revenue FROM orders
          WHERE created_at >= date('now', ?) GROUP BY status`,
      ).bind(cutoff).all<StatusRow>().catch(empty<StatusRow>),

      db.prepare(
        `SELECT date(created_at, ?) AS day, COUNT(*) AS count FROM orders
          WHERE created_at >= date('now', ?) GROUP BY day ORDER BY day`,
      ).bind(KST, cutoff).all<DayRow>().catch(empty<DayRow>),

      db.prepare(
        `SELECT s.name, s.slug,
                COUNT(o.id) AS orders,
                SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
                SUM(CASE WHEN o.status = 'completed' THEN o.total_price ELSE 0 END) AS revenue
           FROM shops s
           LEFT JOIN orders o ON o.shop_id = s.id AND o.created_at >= date('now', ?)
          GROUP BY s.id ORDER BY orders DESC, s.name`,
      ).bind(cutoff).all<ShopRow>().catch(empty<ShopRow>),

      db.prepare(
        `SELECT s.slug, COUNT(r.id) AS count, AVG(r.rating) AS average
           FROM shops s LEFT JOIN reviews r ON r.shop_id = s.id AND r.status = 'visible'
          GROUP BY s.id`,
      ).all<RatingRow>().catch(empty<RatingRow>),

      db.prepare(
        `SELECT event, SUM(count) AS count FROM site_views
          WHERE day >= date('now', ?) GROUP BY event`,
      ).bind(cutoff).all<ViewRow>().catch(empty<ViewRow>),

      db.prepare(
        `SELECT COUNT(*) AS requests,
                SUM(CASE WHEN status = 'handled' THEN 1 ELSE 0 END) AS handled,
                SUM(CASE WHEN status = 'handled' THEN price ELSE 0 END) AS revenue
           FROM store_purchases WHERE created_at >= date('now', ?)`,
      ).bind(cutoff).first<StoreRow>().catch(() => null),

      db.prepare(
        `SELECT item_name AS name, COUNT(*) AS requests,
                SUM(CASE WHEN status = 'handled' THEN 1 ELSE 0 END) AS handled,
                SUM(CASE WHEN status = 'handled' THEN price ELSE 0 END) AS revenue
           FROM store_purchases WHERE created_at >= date('now', ?)
          GROUP BY item_name ORDER BY requests DESC`,
      ).bind(cutoff).all<ItemRow>().catch(empty<ItemRow>),

      db.prepare(
        "SELECT COUNT(*) AS count, AVG(rating) AS average FROM store_reviews WHERE status = 'visible'",
      ).first<PairRow>().catch(() => null),

      db.prepare(
        `SELECT SUM(CASE WHEN status != 'handled' THEN 1 ELSE 0 END) AS waiting, COUNT(*) AS total
           FROM shop_applications`,
      ).first<CountRow>().catch(() => null),
    ]);

  const store = storeRaw as StoreRow | null;
  const storeReviews = storeReviewsRaw as PairRow | null;
  const applications = applicationsRaw as CountRow | null;

  const status = new Map<string, StatusRow>(
    statuses.results.map((row: StatusRow) => [row.status, row] as [string, StatusRow]),
  );
  const pick = (name: string) => status.get(name)?.count ?? 0;
  const total = statuses.results.reduce((sum: number, row: StatusRow) => sum + row.count, 0);
  const viewsBy = new Map<string, number>(
    views.results.map((row: ViewRow) => [row.event, row.count] as [string, number]),
  );
  const ratingBy = new Map<string, RatingRow>(
    ratings.results.map((row: RatingRow) => [row.slug, row] as [string, RatingRow]),
  );

  const shopRows = shops.results.map((row: ShopRow) => {
    const rating = ratingBy.get(row.slug);
    return {
      name: row.name,
      slug: row.slug,
      orders: row.orders,
      completed: row.completed,
      cancelled: row.cancelled,
      revenue: row.revenue ?? 0,
      reviews: rating?.count ?? 0,
      rating: rating?.average ? Math.round(rating.average * 10) / 10 : 0,
    };
  });

  const shopReviews = shopRows.reduce((sum, shop) => sum + shop.reviews, 0);
  const weighted = shopRows.reduce((sum, shop) => sum + shop.rating * shop.reviews, 0);

  return {
    orders: {
      total,
      // Anything not finished and not refused is still owed to someone.
      open: total - pick("completed") - pick("cancelled"),
      completed: pick("completed"),
      cancelled: pick("cancelled"),
      revenue: status.get("completed")?.revenue ?? 0,
    },
    funnel: {
      shopViews: viewsBy.get("shop") ?? 0,
      orders: total,
      storeViews: (viewsBy.get("store") ?? 0) + (viewsBy.get("store_item") ?? 0),
      purchases: store?.requests ?? 0,
    },
    reviews: {
      count: shopReviews,
      rating: shopReviews > 0 ? Math.round((weighted / shopReviews) * 10) / 10 : 0,
      storeCount: storeReviews?.count ?? 0,
      storeRating: storeReviews?.average ? Math.round(storeReviews.average * 10) / 10 : 0,
    },
    store: {
      requests: store?.requests ?? 0,
      handled: store?.handled ?? 0,
      revenue: store?.revenue ?? 0,
    },
    applications: { waiting: applications?.waiting ?? 0, total: applications?.total ?? 0 },
    byDay: byDay.results.map((row: DayRow) => ({ day: row.day, count: row.count })),
    byShop: shopRows,
    byItem: items.results.map((row: ItemRow) => ({
      name: row.name,
      requests: row.requests,
      handled: row.handled,
      revenue: row.revenue ?? 0,
    })),
  };
}
