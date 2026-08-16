/**
 * Things the site owner sells for in-game currency.
 *
 * No real money moves here and the site takes no payment: a purchase is a
 * request that lands in Discord, and the handover happens in game. So a
 * "purchase" row is a record of who asked for what, not a receipt.
 */

import { MAX_ITEM_IMAGES, StorePlan, parsePlans, serialisePlans } from "./store-plans";
import { randomToken } from "./random-token";
import { parseExemptKeys, storeSlotState } from "./store-slots";
import { countLive, fetchLicences } from "./licence-server";

export type StoreImage = { id: string; filename: string };

export type StoreItem = {
  id: string;
  name: string;
  /** A line or two on the card. The long version lives in `detail`. */
  description: string;
  /** Everything worth saying, shown on the product's own page. */
  detail: string;
  /**
   * The terms a buyer is shown once they have asked for it, in Markdown.
   * Buyers only — it never travels with the public listing.
   */
  licence: string;
  /** Small line above the name — "기간제", "한정" and so on. */
  tagline: string;
  plans: StorePlan[];
  images: StoreImage[];
  active: boolean;
  position: number;
  /** Whether the limit on live licences applies at all. */
  slotOn: boolean;
  /** How many licences may be live at once. */
  slotMax: number;
  /** Slots the owner filled by hand, for anything agreed elsewhere. */
  slotManual: number;
  /** Keys that do not take a slot, one per line. */
  exemptKeys: string;
};

export type StorePurchase = {
  id: string;
  /**
   * The buyer's Discord roles when they ordered, if role lookup was on. Empty
   * means it was off, they were not in the server, or it could not be read.
   */
  roles: string[];
  /**
   * Whether the product still has a page to link to. False once it is deleted,
   * switched off, or left with no priced plan — the purchase record outlives
   * all three.
   */
  itemExists: boolean;
  /** Short number the buyer quotes when writing a review or asking about it. */
  orderNo: string;
  itemId: string;
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
  id: string; name: string; description: string; detail: string | null; tagline: string;
  licence: string | null; plans: string | null; active: number; position: number;
  slot_on?: number | null; slot_max?: number | null; slot_manual?: number | null;
  exempt_keys?: string | null;
};

type ImageRow = { id: string; item_id: string; filename: string };

type PurchaseRow = {
  id: string; order_no: string | null; item_id: string | null; item_name: string;
  roles?: string | null;
  item_active?: number | null; item_plans?: string | null;
  plan_label: string; price: number; mc_nick: string; note: string;
  buyer_id: string; buyer_name: string; status: string; created_at: string;
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
    db.prepare(`CREATE TABLE IF NOT EXISTS store_images (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS store_images_item_id_idx ON store_images (item_id, position)"),
    db.prepare("CREATE INDEX IF NOT EXISTS store_purchases_status_idx ON store_purchases (status, created_at DESC)"),
  ]);

  // Added when purchases started carrying the buyer's server roles.
  await db.prepare("ALTER TABLE store_purchases ADD COLUMN roles TEXT").run().catch(() => undefined);

  // Added when a purchase became something a buyer could come back and review.
  await db.prepare("ALTER TABLE store_purchases ADD COLUMN order_no TEXT").run().catch(() => undefined);
  await db.prepare("ALTER TABLE store_purchases ADD COLUMN item_id TEXT").run().catch(() => undefined);
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS store_purchases_order_no_idx ON store_purchases (order_no)")
    .run().catch(() => undefined);

  // Added when a licensed product had to stop being sold past its limit.
  await db.prepare("ALTER TABLE store_items ADD COLUMN slot_on INTEGER NOT NULL DEFAULT 0").run().catch(() => undefined);
  await db.prepare("ALTER TABLE store_items ADD COLUMN slot_max INTEGER NOT NULL DEFAULT 0").run().catch(() => undefined);
  await db.prepare("ALTER TABLE store_items ADD COLUMN slot_manual INTEGER NOT NULL DEFAULT 0").run().catch(() => undefined);
  await db.prepare(`ALTER TABLE store_items ADD COLUMN exempt_keys TEXT NOT NULL DEFAULT ''`).run().catch(() => undefined);

  // Added when a purchase started coming with terms attached.
  await db.prepare(`ALTER TABLE store_items ADD COLUMN licence TEXT NOT NULL DEFAULT ''`).run().catch(() => undefined);

  // Added when products grew a page of their own.
  await db.prepare(`ALTER TABLE store_items ADD COLUMN detail TEXT NOT NULL DEFAULT ''`).run().catch(() => undefined);
}

function toItem(row: ItemRow, images: StoreImage[] = []): StoreItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    detail: row.detail ?? "",
    licence: row.licence ?? "",
    tagline: row.tagline,
    plans: parsePlans(row.plans),
    images,
    active: Boolean(row.active),
    position: row.position,
    slotOn: Boolean(row.slot_on),
    slotMax: Math.max(0, row.slot_max ?? 0),
    slotManual: Math.max(0, row.slot_manual ?? 0),
    exemptKeys: row.exempt_keys ?? "",
  };
}

/* The join answers "does the product still exist", which the id alone cannot. */
const PURCHASE_COLUMNS = `p.id, p.order_no, p.item_id, p.item_name, p.plan_label, p.price,
  p.mc_nick, p.note, p.buyer_id, p.buyer_name, p.status, p.created_at, p.roles,
  i.active AS item_active, i.plans AS item_plans`;
const PURCHASE_FROM = "store_purchases p LEFT JOIN store_items i ON i.id = p.item_id";

const ITEM_COLUMNS = `id, name, description, detail, licence, tagline, plans, active, position,
  slot_on, slot_max, slot_manual, exempt_keys`;

/** One query for every item's pictures rather than one query each. */
async function listImagesByItem(rows: ItemRow[]) {
  const grouped = new Map<string, StoreImage[]>();
  if (rows.length === 0) return grouped;
  const db = await getD1();
  const placeholders = rows.map(() => "?").join(", ");
  const images = await db.prepare(
    `SELECT id, item_id, filename FROM store_images
      WHERE item_id IN (${placeholders}) ORDER BY position ASC, created_at ASC`,
  ).bind(...rows.map((row) => row.id)).all<ImageRow>().catch(() => ({ results: [] as ImageRow[] }));
  for (const image of images.results) {
    const list = grouped.get(image.item_id) ?? [];
    list.push({ id: image.id, filename: image.filename });
    grouped.set(image.item_id, list);
  }
  return grouped;
}

/** Strips the buyer-only fields off a product bound for a public page. */
export function withoutLicence(item: StoreItem): StoreItem {
  return { ...item, licence: "" };
}

/** What the store page shows: on sale, in the owner's order. */
export async function listActiveItems(): Promise<StoreItem[]> {
  await ensureTables();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT ${ITEM_COLUMNS} FROM store_items WHERE active = 1 ORDER BY position ASC, created_at ASC`,
  ).all<ItemRow>().catch(() => ({ results: [] as ItemRow[] }));
  const images = await listImagesByItem(rows.results);
  // An item with no priced plan has nothing to buy, so it does not belong here.
  return rows.results.map((row) => toItem(row, images.get(row.id) ?? []))
    .filter((item) => item.plans.length > 0)
    .map(withoutLicence);
}

/** Everything, including what is switched off. Owner view. */
export async function listAllItems(): Promise<StoreItem[]> {
  await ensureTables();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT ${ITEM_COLUMNS} FROM store_items ORDER BY position ASC, created_at ASC`,
  ).all<ItemRow>().catch(() => ({ results: [] as ItemRow[] }));
  const images = await listImagesByItem(rows.results);
  return rows.results.map((row) => toItem(row, images.get(row.id) ?? []));
}

export async function getItem(id: string): Promise<StoreItem | null> {
  await ensureTables();
  const db = await getD1();
  const row = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM store_items WHERE id = ?`)
    .bind(id).first<ItemRow>().catch(() => null);
  if (!row) return null;
  return toItem(row, (await listImagesByItem([row])).get(row.id) ?? []);
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
  detail: string;
  licence: string;
  tagline: string;
  plans: StorePlan[];
  active: boolean;
  position: number;
  slotOn: boolean;
  slotMax: number;
  slotManual: number;
  exemptKeys: string;
}) {
  await ensureTables();
  const db = await getD1();
  await db.prepare(`UPDATE store_items SET name = ?, description = ?, detail = ?, licence = ?,
    tagline = ?, plans = ?, active = ?, position = ?,
    slot_on = ?, slot_max = ?, slot_manual = ?, exempt_keys = ? WHERE id = ?`).bind(
    input.name.trim().slice(0, 60) || "새 상품",
    input.description.trim().slice(0, 600),
    input.detail.trim().slice(0, 4000),
    input.licence.trim().slice(0, 20000),
    input.tagline.trim().slice(0, 30),
    serialisePlans(input.plans),
    input.active ? 1 : 0,
    Math.max(0, Math.min(999, Math.trunc(input.position) || 0)),
    input.slotOn ? 1 : 0,
    Math.max(0, Math.min(9999, Math.trunc(input.slotMax) || 0)),
    Math.max(0, Math.min(9999, Math.trunc(input.slotManual) || 0)),
    input.exemptKeys.trim().slice(0, 4000),
    id,
  ).run();
}

/** Hands back the R2 keys so the caller can clear the files those rows pointed at. */
export async function deleteItem(id: string) {
  await ensureTables();
  const db = await getD1();
  const images = await db.prepare("SELECT object_key FROM store_images WHERE item_id = ?")
    .bind(id).all<{ object_key: string }>().catch(() => ({ results: [] as { object_key: string }[] }));
  const removed = await db.prepare("DELETE FROM store_items WHERE id = ?")
    .bind(id).run().catch(() => null);
  if (!removed?.meta.changes) return null;
  await db.batch([
    db.prepare("DELETE FROM store_images WHERE item_id = ?").bind(id),
    db.prepare("DELETE FROM store_reviews WHERE item_id = ?").bind(id),
  ]).catch(() => undefined);
  return images.results.map((row) => row.object_key);
}

export async function addItemImage(input: {
  itemId: string; objectKey: string; filename: string; contentType: string;
}) {
  await ensureTables();
  const db = await getD1();
  const tail = await db.prepare(
    "SELECT COUNT(*) AS count, MAX(position) AS last FROM store_images WHERE item_id = ?",
  ).bind(input.itemId).first<{ count: number; last: number | null }>();
  if ((tail?.count ?? 0) >= MAX_ITEM_IMAGES) {
    throw new Error(`사진은 상품당 최대 ${MAX_ITEM_IMAGES}장까지 올릴 수 있습니다.`);
  }
  await db.prepare(`INSERT INTO store_images
    (id, item_id, object_key, filename, content_type, position)
    VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.itemId, input.objectKey,
    input.filename, input.contentType, (tail?.last ?? -1) + 1,
  ).run();
}

/** Returns the R2 key left orphaned, or null when there was no such image. */
export async function removeItemImage(itemId: string, imageId: string) {
  await ensureTables();
  const db = await getD1();
  const image = await db.prepare("SELECT object_key FROM store_images WHERE id = ? AND item_id = ?")
    .bind(imageId, itemId).first<{ object_key: string }>().catch(() => null);
  if (!image) return null;
  await db.prepare("DELETE FROM store_images WHERE id = ? AND item_id = ?").bind(imageId, itemId).run();
  return image.object_key;
}

/**
 * Writes a new order for a product's pictures. Same rules as the shop side:
 * ids that are not this product's are dropped, and anything left out keeps its
 * place at the end.
 */
export async function reorderItemImages(itemId: string, orderedIds: string[]) {
  await ensureTables();
  const db = await getD1();
  const rows = await db.prepare(
    "SELECT id FROM store_images WHERE item_id = ? ORDER BY position ASC, created_at ASC",
  ).bind(itemId).all<{ id: string }>().catch(() => ({ results: [] as { id: string }[] }));

  const existing: string[] = rows.results.map((row: { id: string }) => row.id);
  const mine = new Set(existing);
  const asked = orderedIds.filter((id) => mine.has(id));
  const seen = new Set(asked);
  const settled = [...asked, ...existing.filter((id) => !seen.has(id))];
  if (settled.length === 0) return false;

  await db.batch(settled.map((id, at) =>
    db.prepare("UPDATE store_images SET position = ? WHERE id = ? AND item_id = ?").bind(at, id, itemId)));
  return true;
}

/**
 * Only while the product is on sale.
 *
 * The shop and review image routes both refuse once their owner is hidden;
 * this one did not, so switching a product off left its pictures reachable to
 * anyone who had kept a link.
 */
export async function getStoreImageObjectKey(imageId: string) {
  await ensureTables();
  const db = await getD1();
  const row = await db.prepare(
    `SELECT i.object_key FROM store_images i
       JOIN store_items s ON s.id = i.item_id
      WHERE i.id = ? AND s.active = 1`,
  ).bind(imageId).first<{ object_key: string }>().catch(() => null);
  return row?.object_key ?? null;
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

  // Checked here rather than only in the page, so a stale tab cannot slip an
  // order past a limit that filled up while it was open.
  const slots = await slotsForItem(item).catch(() => null);
  if (slots?.full) {
    return {
      ok: false,
      error: "지금은 자리가 다 찼습니다. 자리가 나면 다시 열립니다.",
      status: 409,
    };
  }

  // One open request at a time, the same rule the order form and the shop
  // application already follow. Without it one account can bury the owner's
  // channel in notifications nobody asked for.
  const db0 = await getD1();
  const waiting = await db0.prepare(
    "SELECT 1 AS found FROM store_purchases WHERE buyer_id = ? AND item_id = ? AND status = 'new' LIMIT 1",
  ).bind(input.buyerId, item.id).first<{ found: number }>().catch(() => null);
  if (waiting) {
    return {
      ok: false,
      error: "이미 넣으신 요청이 처리 중입니다. 전달이 끝난 뒤에 다시 신청해 주세요.",
      status: 409,
    };
  }

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
    roles: [],
    itemExists: true,
    orderNo: randomToken(8),
    itemId: item.id,
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
    (id, order_no, item_id, item_name, plan_label, price, mc_nick, note, buyer_id, buyer_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    purchase.id, purchase.orderNo, purchase.itemId, purchase.itemName,
    purchase.planLabel, purchase.price, purchase.mcNick, purchase.note,
    purchase.buyerId, purchase.buyerName,
  ).run();

  return { ok: true, purchase };
}

function toPurchase(row: PurchaseRow): StorePurchase {
  return {
    id: row.id,
    roles: row.roles ? row.roles.split("\u001f") : [],
    // The same three conditions the product page checks before rendering, read
    // from the joined row rather than restated in SQL.
    itemExists: Boolean(row.item_active) && parsePlans(row.item_plans).length > 0,
    // Purchases taken before order numbers existed still need something to quote.
    orderNo: row.order_no ?? row.id.slice(0, 8).toUpperCase(),
    itemId: row.item_id ?? "",
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
    `SELECT ${PURCHASE_COLUMNS} FROM ${PURCHASE_FROM}
      ORDER BY p.status = 'new' DESC, p.created_at DESC LIMIT ?`,
  ).bind(limit).all<PurchaseRow>().catch(() => ({ results: [] as PurchaseRow[] }));
  return rows.results.map(toPurchase);
}

/**
 * How full this product is, counting live licences and the owner's manual fill.
 *
 * A licence server that cannot be reached leaves the count stale, and a stale
 * count never turns anyone away — being short is likelier than being over.
 */
export async function slotsForItem(item: StoreItem) {
  if (!item.slotOn || item.slotMax <= 0) {
    return storeSlotState({ slotOn: false, slotMax: 0, slotManual: 0, licences: 0 });
  }
  const { rows, stale } = await fetchLicences();
  return storeSlotState({
    slotOn: item.slotOn,
    slotMax: item.slotMax,
    slotManual: item.slotManual,
    licences: countLive(rows, parseExemptKeys(item.exemptKeys)),
    stale,
  });
}

/** A buyer's own purchases, for their profile page. */
export async function listPurchasesForUser(buyerId: string, limit = 50): Promise<StorePurchase[]> {
  await ensureTables();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT ${PURCHASE_COLUMNS} FROM ${PURCHASE_FROM}
      WHERE p.buyer_id = ? ORDER BY p.created_at DESC LIMIT ?`,
  ).bind(buyerId, limit).all<PurchaseRow>().catch(() => ({ results: [] as PurchaseRow[] }));
  return rows.results.map(toPurchase);
}

/**
 * Whether this person has bought anything at all.
 *
 * The header asks on every page, so it stops at the first row rather than
 * counting them.
 */
export async function hasPurchases(buyerId: string) {
  await ensureTables();
  const db = await getD1();
  const row = await db.prepare("SELECT 1 AS found FROM store_purchases WHERE buyer_id = ? LIMIT 1")
    .bind(buyerId).first<{ found: number }>().catch(() => null);
  return Boolean(row);
}

/** Looks a purchase up by the number the buyer sees, not its internal id. */
export async function getPurchaseByOrderNo(orderNo: string): Promise<StorePurchase | null> {
  await ensureTables();
  const db = await getD1();
  const row = await db.prepare(
    `SELECT ${PURCHASE_COLUMNS} FROM ${PURCHASE_FROM} WHERE p.order_no = ?`,
  ).bind(orderNo.trim().toUpperCase()).first<PurchaseRow>().catch(() => null);
  return row ? toPurchase(row) : null;
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
 * Role names are joined on a character no role name can contain, so a comma in
 * a name cannot split it into two.
 */
export async function setPurchaseRoles(id: string, roles: string[]) {
  await ensureTables();
  const db = await getD1();
  await db.prepare("UPDATE store_purchases SET roles = ? WHERE id = ?")
    .bind(roles.length > 0 ? roles.join("\u001f") : null, id).run().catch(() => undefined);
}

/** Forgets every role ever recorded. The owner's off switch, after the fact. */
export async function clearAllPurchaseRoles() {
  await ensureTables();
  const db = await getD1();
  const cleared = await db.prepare("UPDATE store_purchases SET roles = NULL WHERE roles IS NOT NULL")
    .run().catch(() => null);
  return cleared?.meta.changes ?? 0;
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

/**
 * The server whose roles get attached to a purchase. Blank turns the lookup
 * off; nothing else changes and past records stay as they were.
 */
export async function getStoreGuildId() {
  const db = await getD1();
  await db.prepare("CREATE TABLE IF NOT EXISTS site_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const row = await db.prepare("SELECT value FROM site_meta WHERE key = 'store_guild_id'")
    .first<{ value: string }>().catch(() => null);
  return row?.value ?? "";
}

export async function setStoreGuildId(guildId: string) {
  const db = await getD1();
  await db.prepare("CREATE TABLE IF NOT EXISTS site_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await db.prepare("INSERT OR REPLACE INTO site_meta (key, value) VALUES ('store_guild_id', ?)")
    .bind(guildId.trim()).run();
}
