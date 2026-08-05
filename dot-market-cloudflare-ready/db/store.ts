/**
 * Things the site owner sells for in-game currency.
 *
 * No real money moves here and the site takes no payment: a purchase is a
 * request that lands in Discord, and the handover happens in game. So a
 * "purchase" row is a record of who asked for what, not a receipt.
 */

import { StorePlan, parsePlans, serialisePlans } from "./store-plans";

export type StoreItem = {
  id: string;
  name: string;
  description: string;
  /** Small line above the name — "기간제", "한정" and so on. */
  tagline: string;
  plans: StorePlan[];
  active: boolean;
  position: number;
};

export type StorePurchase = {
  id: string;
  itemName: string;
  planLabel: string;
  price: number;
  mcNick: string;
  note: string;
  buyerId: string;
  buyerName: string;
  handled: boolean;
  createdAt: string;
};

type ItemRow = {
  id: string; name: string; description: string; tagline: string;
  plans: string | null; active: number; position: number;
};

type PurchaseRow = {
  id: string; item_name: string; plan_label: string; price: number;
  mc_nick: string; note: string; buyer_id: string; buyer_name: string;
  status: string; created_at: string;
};

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("데이터베이스가 연결되지 않았습니다.");
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
    db.prepare(`CREATE TABLE IF NOT EXISTS store_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tagline TEXT NOT NULL DEFAULT '',
      plans TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS store_purchases (
      id TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      plan_label TEXT NOT NULL,
      price INTEGER NOT NULL,
      mc_nick TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      buyer_id TEXT NOT NULL,
      buyer_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS store_purchases_status_idx ON store_purchases (status, created_at DESC)"),
  ]);
}

function toItem(row: ItemRow): StoreItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tagline: row.tagline,
    plans: parsePlans(row.plans),
    active: Boolean(row.active),
    position: row.position,
  };
}

const ITEM_COLUMNS = "id, name, description, tagline, plans, active, position";

/** What the store page shows: on sale, in the owner's order. */
export async function listActiveItems(): Promise<StoreItem[]> {
  await ensureTables();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT ${ITEM_COLUMNS} FROM store_items WHERE active = 1 ORDER BY position ASC, created_at ASC`,
  ).all<ItemRow>().catch(() => ({ results: [] as ItemRow[] }));
  // An item with no priced plan has nothing to buy, so it does not belong here.
  return rows.results.map(toItem).filter((item) => item.plans.length > 0);
}

/** Everything, including what is switched off. Owner view. */
export async function listAllItems(): Promise<StoreItem[]> {
  await ensureTables();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT ${ITEM_COLUMNS} FROM store_items ORDER BY position ASC, created_at ASC`,
  ).all<ItemRow>().catch(() => ({ results: [] as ItemRow[] }));
  return rows.results.map(toItem);
}

export async function getItem(id: string): Promise<StoreItem | null> {
  await ensureTables();
  const db = await getD1();
  const row = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM store_items WHERE id = ?`)
    .bind(id).first<ItemRow>().catch(() => null);
  return row ? toItem(row) : null;
}

export async function createItem(name: string) {
  await ensureTables();
  const db = await getD1();
  const tail = await db.prepare("SELECT MAX(position) AS last FROM store_items")
    .first<{ last: number | null }>().catch(() => null);
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO store_items (id, name, position, active) VALUES (?, ?, ?, 0)",
  ).bind(id, name.trim().slice(0, 60) || "새 상품", (tail?.last ?? -1) + 1).run();
  return id;
}

export async function updateItem(id: string, input: {
  name: string;
  description: string;
  tagline: string;
  plans: StorePlan[];
  active: boolean;
  position: number;
}) {
  await ensureTables();
  const db = await getD1();
  await db.prepare(`UPDATE store_items SET name = ?, description = ?, tagline = ?,
    plans = ?, active = ?, position = ? WHERE id = ?`).bind(
    input.name.trim().slice(0, 60) || "새 상품",
    input.description.trim().slice(0, 600),
    input.tagline.trim().slice(0, 30),
    serialisePlans(input.plans),
    input.active ? 1 : 0,
    Math.max(0, Math.min(999, Math.trunc(input.position) || 0)),
    id,
  ).run();
}

export async function deleteItem(id: string) {
  await ensureTables();
  const db = await getD1();
  const removed = await db.prepare("DELETE FROM store_items WHERE id = ?")
    .bind(id).run().catch(() => null);
  return Boolean(removed?.meta.changes);
}

type Outcome = { ok: true; purchase: StorePurchase } | { ok: false; error: string; status: number };

/**
 * Records a request to buy. The price is read from the item rather than taken
 * from the browser — otherwise the buyer decides what they pay.
 */
export async function recordPurchase(input: {
  itemId: string;
  planLabel: string;
  mcNick: string;
  note: string;
  buyerId: string;
  buyerName: string;
}): Promise<Outcome> {
  await ensureTables();

  const item = await getItem(input.itemId);
  if (!item || !item.active) {
    return { ok: false, error: "지금은 판매하지 않는 상품입니다.", status: 404 };
  }

  const plan = item.plans.find((candidate) => candidate.label === input.planLabel);
  if (!plan) return { ok: false, error: "그런 기간이 없습니다.", status: 400 };

  const mcNick = input.mcNick.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(mcNick)) {
    return {
      ok: false,
      error: "도스 닉네임은 영문·숫자·밑줄(_) 3~16자입니다. 물건을 받을 계정이라 정확해야 합니다.",
      status: 400,
    };
  }

  const price = plan.salePrice > 0 && plan.salePrice < plan.price ? plan.salePrice : plan.price;
  const purchase: StorePurchase = {
    id: crypto.randomUUID(),
    itemName: item.name,
    planLabel: plan.label,
    price,
    mcNick,
    note: input.note.trim().slice(0, 300),
    buyerId: input.buyerId,
    buyerName: input.buyerName.slice(0, 80),
    handled: false,
    createdAt: new Date().toISOString(),
  };

  const db = await getD1();
  await db.prepare(`INSERT INTO store_purchases
    (id, item_name, plan_label, price, mc_nick, note, buyer_id, buyer_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    purchase.id, purchase.itemName, purchase.planLabel, purchase.price,
    purchase.mcNick, purchase.note, purchase.buyerId, purchase.buyerName,
  ).run();

  return { ok: true, purchase };
}

function toPurchase(row: PurchaseRow): StorePurchase {
  return {
    id: row.id,
    itemName: row.item_name,
    planLabel: row.plan_label,
    price: row.price,
    mcNick: row.mc_nick,
    note: row.note,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    handled: row.status === "handled",
    createdAt: row.created_at,
  };
}

export async function listPurchases(limit = 100): Promise<StorePurchase[]> {
  await ensureTables();
  const db = await getD1();
  const rows = await db.prepare(
    // Unhandled first: those are the ones still owed something.
    `SELECT id, item_name, plan_label, price, mc_nick, note, buyer_id, buyer_name, status, created_at
       FROM store_purchases ORDER BY status = 'new' DESC, created_at DESC LIMIT ?`,
  ).bind(limit).all<PurchaseRow>().catch(() => ({ results: [] as PurchaseRow[] }));
  return rows.results.map(toPurchase);
}

export async function setPurchaseHandled(id: string, handled: boolean) {
  await ensureTables();
  const db = await getD1();
  const changed = await db.prepare("UPDATE store_purchases SET status = ? WHERE id = ?")
    .bind(handled ? "handled" : "new", id).run().catch(() => null);
  return Boolean(changed?.meta.changes);
}

export async function deletePurchase(id: string) {
  await ensureTables();
  const db = await getD1();
  const removed = await db.prepare("DELETE FROM store_purchases WHERE id = ?")
    .bind(id).run().catch(() => null);
  return Boolean(removed?.meta.changes);
}

/**
 * The channel purchase notices go to, kept in site_meta so it can change
 * without a deploy.
 */
export async function getStoreChannelId() {
  const db = await getD1();
  await db.prepare("CREATE TABLE IF NOT EXISTS site_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const row = await db.prepare("SELECT value FROM site_meta WHERE key = 'store_channel_id'")
    .first<{ value: string }>().catch(() => null);
  return row?.value ?? "";
}

export async function setStoreChannelId(channelId: string) {
  const db = await getD1();
  await db.prepare("CREATE TABLE IF NOT EXISTS site_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await db.prepare("INSERT OR REPLACE INTO site_meta (key, value) VALUES ('store_channel_id', ?)")
    .bind(channelId.trim()).run();
}
