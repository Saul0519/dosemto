/**
 * One ledger over both halves of the market.
 *
 * A drawing order and a mod sale are different things in the database — taken
 * differently, delivered differently, each with its own word for what stage it
 * is at. But "what came in, and from whom" is the same question of both, so
 * this flattens them into one row shape.
 *
 * Money counts only when the work is done: a finished drawing, a handed-over
 * licence. A request still in the queue is not takings, and a refused one never
 * will be. `counted` carries that so nothing downstream has to work it out
 * again and get it slightly different.
 *
 * The grouping is not done here. Which way the owner wants it sliced — by shop,
 * by product, by month, by person — changes minute to minute, and asking the
 * database each time is a round trip for a rearrangement. The rows are few
 * enough to send once and turn over in the browser.
 */

import { COUNTS_AS_REVENUE, LedgerRow } from "./ledger-labels";
import { ensureOrdersTable } from "./orders";
import { ensureTables as ensureStoreTables } from "./store";

export type { LedgerRow } from "./ledger-labels";

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

type ShopRow = {
  id: string; shop_id: string; shop_name: string; created_at: string;
  player_name: string | null; total_price: number; status: string;
};

type StoreRow = {
  id: string; item_id: string | null; item_name: string; order_no: string | null;
  created_at: string; mc_nick: string; buyer_id: string;
  price: number; status: string;
};

/**
 * Everything, newest first.
 *
 * Capped, because a ledger is looked over rather than paged through, and an
 * owner with more rows than this wants the spreadsheet — which is built from
 * whatever this returns.
 */
export async function readLedger(limit = 2000): Promise<LedgerRow[]> {
  const db = await getD1();
  // Both halves have to be there before anything is added up. A half that
  // failed and a half that is genuinely empty look the same once summed, and on
  // a page about money a confident wrong total is worse than an error.
  await Promise.all([ensureOrdersTable(), ensureStoreTables()]);

  const [shopSide, storeSide] = await Promise.all([
    db.prepare(
      `SELECT o.id, o.shop_id, s.name AS shop_name, o.created_at,
              o.player_name, o.total_price, o.status
         FROM orders o JOIN shops s ON s.id = o.shop_id
        ORDER BY o.created_at DESC LIMIT ?`,
    ).bind(limit).all<ShopRow>(),

    db.prepare(
      `SELECT p.id, p.item_id, p.item_name, p.order_no, p.created_at,
              p.mc_nick, p.buyer_id, p.price, p.status
         FROM store_purchases p ORDER BY p.created_at DESC LIMIT ?`,
    ).bind(limit).all<StoreRow>(),
  ]);

  const rows: LedgerRow[] = [
    ...shopSide.results.map((row): LedgerRow => ({
      key: `shop:${row.id}`,
      kind: "shop",
      id: row.id,
      at: row.created_at,
      // Drawing orders predate order numbers, so the short form of the id
      // stands in — the same one the order screen has always shown.
      orderNo: row.id.slice(0, 8).toUpperCase(),
      source: row.shop_name,
      sourceId: row.shop_id,
      customer: (row.player_name ?? "").trim(),
      customerIsNick: false,
      customerId: "",
      status: row.status,
      price: row.total_price,
      counted: row.status === COUNTS_AS_REVENUE.shop,
    })),
    ...storeSide.results.map((row): LedgerRow => ({
      key: `store:${row.id}`,
      kind: "store",
      id: row.id,
      at: row.created_at,
      orderNo: row.order_no ?? row.id.slice(0, 8).toUpperCase(),
      source: row.item_name,
      sourceId: row.item_id ?? "",
      customer: row.mc_nick.trim(),
      customerIsNick: true,
      customerId: row.buyer_id,
      status: row.status,
      price: row.price,
      counted: row.status === COUNTS_AS_REVENUE.store,
    })),
  ];

  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
