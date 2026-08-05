/**
 * The one thing a signed-in visitor still owes us.
 *
 * Finished work and delivered goods are worth a review, but nobody comes back
 * on their own to write one. This finds the oldest thing a person has received
 * and not yet written about, so the site can ask once and then get out of the
 * way.
 *
 * One query per kind, and only for signed-in visitors — a stranger is never
 * asked for anything.
 */

export type Nudge = {
  /** Where the review form lives. */
  href: string;
  /** What they are being asked about. */
  what: string;
  kind: "order" | "purchase";
  /** How many more of theirs are waiting, beyond this one. */
  others: number;
};

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

type OrderRow = { id: string; shop_name: string; waiting: number };
type PurchaseRow = { order_no: string; item_name: string; waiting: number };

export async function findNudge(discordId: string): Promise<Nudge | null> {
  const db = await getD1();

  // Oldest first: the one they have been sitting on longest is the one most
  // likely to be forgotten entirely.
  const [order, purchase] = await Promise.all([
    db.prepare(
      `SELECT o.id, s.name AS shop_name,
              (SELECT COUNT(*) FROM orders x
                WHERE x.player_uuid = o.player_uuid AND x.status = 'completed'
                  AND x.id NOT IN (SELECT order_id FROM reviews)) AS waiting
         FROM orders o JOIN shops s ON s.id = o.shop_id
        WHERE o.player_uuid = ? AND o.status = 'completed' AND s.active = 1
          AND o.id NOT IN (SELECT order_id FROM reviews)
        ORDER BY o.created_at ASC LIMIT 1`,
    ).bind(discordId).first<OrderRow>().catch(() => null),

    db.prepare(
      `SELECT p.order_no, p.item_name,
              (SELECT COUNT(*) FROM store_purchases y
                WHERE y.buyer_id = p.buyer_id AND y.status = 'handled'
                  AND y.order_no IS NOT NULL
                  AND y.order_no NOT IN (SELECT order_no FROM store_reviews)) AS waiting
         FROM store_purchases p JOIN store_items i ON i.id = p.item_id
        WHERE p.buyer_id = ? AND p.status = 'handled' AND p.order_no IS NOT NULL
          AND i.active = 1
          AND p.order_no NOT IN (SELECT order_no FROM store_reviews)
        ORDER BY p.created_at ASC LIMIT 1`,
    ).bind(discordId).first<PurchaseRow>().catch(() => null),
  ]);

  const waiting = (order?.waiting ?? 0) + (purchase?.waiting ?? 0);

  // A drawing takes longer and costs more than a mod key, so if both are owed
  // the drawing is the one worth asking about.
  if (order) {
    return {
      href: `/review/${encodeURIComponent(order.id)}`,
      what: order.shop_name,
      kind: "order",
      others: Math.max(0, waiting - 1),
    };
  }
  if (purchase) {
    return {
      href: `/store/review/${encodeURIComponent(purchase.order_no)}`,
      what: purchase.item_name,
      kind: "purchase",
      others: Math.max(0, waiting - 1),
    };
  }
  return null;
}
