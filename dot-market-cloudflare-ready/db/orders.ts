import { isSuperAdmin } from "./shops";

export const ORDER_STATUSES = ["new", "working", "completed", "cancelled", "notification_failed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

type OrderRow = {
  id: string;
  shop_id: string;
  shop_name: string;
  contact: string;
  note: string;
  grid_x: number;
  grid_y: number;
  tile_count: number;
  deadline: number;
  total_price: number;
  crop_label: string;
  original_filename: string;
  preview_object_key: string;
  preview_content_type: string;
  original_object_key: string | null;
  original_content_type: string | null;
  player_uuid: string | null;
  player_name: string | null;
  status: OrderStatus;
  webhook_sent: number;
  created_at: string;
  updated_at: string;
};

export type ManagedOrder = {
  id: string;
  shopId: string;
  shopName: string;
  contact: string;
  note: string;
  gridX: number;
  gridY: number;
  tileCount: number;
  deadline: number;
  totalPrice: number;
  cropLabel: string;
  originalFilename: string;
  hasOriginal: boolean;
  playerName: string | null;
  status: OrderStatus;
  webhookSent: boolean;
  createdAt: string;
  updatedAt: string;
};

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("주문 데이터베이스가 연결되지 않았습니다.");
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
let migrateOrdersTableReady: Promise<void> | null = null;

async function ensureOrdersTable() {
  if (!migrateOrdersTableReady) {
    migrateOrdersTableReady = migrateOrdersTable().catch((error) => { migrateOrdersTableReady = null; throw error; });
  }
  return migrateOrdersTableReady;
}

async function migrateOrdersTable() {
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      contact TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      grid_x INTEGER NOT NULL,
      grid_y INTEGER NOT NULL,
      tile_count INTEGER NOT NULL,
      deadline INTEGER NOT NULL,
      total_price INTEGER NOT NULL,
      crop_label TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      preview_object_key TEXT NOT NULL UNIQUE,
      preview_content_type TEXT NOT NULL DEFAULT 'image/png',
      original_object_key TEXT,
      original_content_type TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      webhook_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS orders_shop_created_idx ON orders (shop_id, created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC)"),
  ]);

  // Added after the table shipped, so CREATE TABLE above cannot introduce it on
  // an existing database. SQLite has no ADD COLUMN IF NOT EXISTS; a duplicate
  // column error just means it is already there.
  await db.prepare("ALTER TABLE orders ADD COLUMN webhook_message_id TEXT")
    .run().catch(() => undefined);
  // The signed-in account that placed the order. Column names predate the
  // switch from Minecraft to Discord sign-in; they now hold the Discord
  // snowflake and display name.
  await db.prepare("ALTER TABLE orders ADD COLUMN player_uuid TEXT").run().catch(() => undefined);
  await db.prepare("ALTER TABLE orders ADD COLUMN player_name TEXT").run().catch(() => undefined);
}

export async function setOrderMessageId(id: string, messageId: string) {
  await getD1().then((db) =>
    db.prepare("UPDATE orders SET webhook_message_id = ? WHERE id = ?").bind(messageId, id).run(),
  ).catch(() => undefined);
}

function toManagedOrder(row: OrderRow): ManagedOrder {
  return {
    id: row.id,
    shopId: row.shop_id,
    shopName: row.shop_name,
    contact: row.contact,
    note: row.note,
    gridX: row.grid_x,
    gridY: row.grid_y,
    tileCount: row.tile_count,
    deadline: row.deadline,
    totalPrice: row.total_price,
    cropLabel: row.crop_label,
    originalFilename: row.original_filename,
    hasOriginal: Boolean(row.original_object_key),
    playerName: row.player_name,
    status: row.status,
    webhookSent: Boolean(row.webhook_sent),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const orderColumns = `o.id, o.shop_id, s.name AS shop_name, o.contact, o.note,
  o.grid_x, o.grid_y, o.tile_count, o.deadline, o.total_price, o.crop_label,
  o.original_filename, o.preview_object_key, o.preview_content_type,
  o.original_object_key, o.original_content_type, o.player_uuid, o.player_name,
  o.status, o.webhook_sent, o.created_at, o.updated_at`;

export async function createOrder(input: {
  id: string;
  shopId: string;
  contact: string;
  note: string;
  gridX: number;
  gridY: number;
  tileCount: number;
  deadline: number;
  totalPrice: number;
  cropLabel: string;
  originalFilename: string;
  previewObjectKey: string;
  previewContentType: string;
  originalObjectKey: string | null;
  originalContentType: string | null;
  playerUuid: string;
  playerName: string;
}) {
  await ensureOrdersTable();
  await getD1().then((db) => db.prepare(`INSERT INTO orders (
    id, shop_id, contact, note, grid_x, grid_y, tile_count, deadline,
    total_price, crop_label, original_filename, preview_object_key,
    preview_content_type, original_object_key, original_content_type,
    player_uuid, player_name
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    input.id, input.shopId, input.contact, input.note, input.gridX, input.gridY,
    input.tileCount, input.deadline, input.totalPrice, input.cropLabel,
    input.originalFilename, input.previewObjectKey, input.previewContentType,
    input.originalObjectKey, input.originalContentType,
    input.playerUuid, input.playerName,
  ).run());
}

export async function setOrderWebhookResult(id: string, sent: boolean) {
  await ensureOrdersTable();
  await getD1().then((db) => db.prepare(`UPDATE orders SET webhook_sent = ?,
    status = CASE WHEN ? = 1 THEN 'new' ELSE 'notification_failed' END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(sent ? 1 : 0, sent ? 1 : 0, id).run());
}

export async function listManagedOrders(email: string): Promise<ManagedOrder[]> {
  await ensureOrdersTable();
  const db = await getD1();
  const result = await (await isSuperAdmin(email)
    ? db.prepare(`SELECT ${orderColumns} FROM orders o JOIN shops s ON s.id = o.shop_id
        ORDER BY o.created_at DESC LIMIT 250`).all<OrderRow>()
    : db.prepare(`SELECT ${orderColumns} FROM orders o JOIN shops s ON s.id = o.shop_id
        WHERE lower(s.manager_email) = lower(?) ORDER BY o.created_at DESC LIMIT 250`).bind(email.trim()).all<OrderRow>());
  return result.results.map(toManagedOrder);
}

async function orderRowForManager(id: string, email: string) {
  await ensureOrdersTable();
  const db = await getD1();
  if (await isSuperAdmin(email)) {
    return db.prepare(`SELECT ${orderColumns} FROM orders o JOIN shops s ON s.id = o.shop_id WHERE o.id = ?`)
      .bind(id).first<OrderRow>();
  }
  return db.prepare(`SELECT ${orderColumns} FROM orders o JOIN shops s ON s.id = o.shop_id
    WHERE o.id = ? AND lower(s.manager_email) = lower(?)`).bind(id, email.trim()).first<OrderRow>();
}

export async function updateOrderStatus(id: string, email: string, status: OrderStatus) {
  const row = await orderRowForManager(id, email);
  if (!row) return null;
  if (status === "notification_failed") return null;
  await getD1().then((db) => db.prepare(
    "UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(status, id).run());
  return toManagedOrder({ ...row, status, updated_at: new Date().toISOString() });
}

export async function getOrderFileForManager(id: string, email: string, kind: "preview" | "original") {
  const row = await orderRowForManager(id, email);
  if (!row) return null;
  if (kind === "preview") {
    return {
      objectKey: row.preview_object_key,
      contentType: row.preview_content_type,
      filename: `DOT_ORDER_${row.id}_${row.grid_x}x${row.grid_y}.png`,
    };
  }
  if (!row.original_object_key || !row.original_content_type) return null;
  return {
    objectKey: row.original_object_key,
    contentType: row.original_content_type,
    filename: row.original_filename,
  };
}


export type MyOrder = {
  id: string;
  shopName: string;
  shopSlug: string;
  gridX: number;
  gridY: number;
  tileCount: number;
  deadline: number;
  totalPrice: number;
  cropLabel: string;
  originalFilename: string;
  status: OrderStatus;
  createdAt: string;
};

/** The customer's own order history, keyed on their Discord snowflake. */
export async function listOrdersForUser(discordId: string): Promise<MyOrder[]> {
  await ensureOrdersTable();
  const db = await getD1();
  const rows = await db.prepare(
    `SELECT o.id, s.name AS shop_name, s.slug AS shop_slug, o.grid_x, o.grid_y,
            o.tile_count, o.deadline, o.total_price, o.crop_label,
            o.original_filename, o.status, o.created_at
       FROM orders o JOIN shops s ON s.id = o.shop_id
      WHERE o.player_uuid = ? ORDER BY o.created_at DESC LIMIT 100`,
  ).bind(discordId).all<{
    id: string; shop_name: string; shop_slug: string; grid_x: number; grid_y: number;
    tile_count: number; deadline: number; total_price: number; crop_label: string;
    original_filename: string; status: OrderStatus; created_at: string;
  }>().catch(() => ({ results: [] }));
  return rows.results.map((row) => ({
    id: row.id,
    shopName: row.shop_name,
    shopSlug: row.shop_slug,
    gridX: row.grid_x,
    gridY: row.grid_y,
    tileCount: row.tile_count,
    deadline: row.deadline,
    totalPrice: row.total_price,
    cropLabel: row.crop_label,
    originalFilename: row.original_filename,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/** The converted pattern for one of the caller's own orders. */
export async function getOwnOrderPreview(orderId: string, discordId: string) {
  await ensureOrdersTable();
  const row = await getD1().then((db) => db.prepare(
    "SELECT preview_object_key, preview_content_type, grid_x, grid_y FROM orders WHERE id = ? AND player_uuid = ?",
  ).bind(orderId, discordId).first<{
    preview_object_key: string; preview_content_type: string; grid_x: number; grid_y: number;
  }>()).catch(() => null);
  if (!row) return null;
  return {
    objectKey: row.preview_object_key,
    contentType: row.preview_content_type,
    filename: `DOT_ORDER_${orderId}_${row.grid_x}x${row.grid_y}.png`,
  };
}

/**
 * Removes one order and everything hanging off it. Owner only — a shop must not
 * be able to erase an order it does not like the look of.
 * Returns the R2 keys so the caller can purge the files too.
 */
export async function deleteOrderCascade(orderId: string) {
  await ensureOrdersTable();
  const db = await getD1();

  const row = await db.prepare(
    "SELECT id, preview_object_key, original_object_key FROM orders WHERE id = ?",
  ).bind(orderId).first<{
    id: string; preview_object_key: string; original_object_key: string | null;
  }>().catch(() => null);
  if (!row) return null;

  await db.prepare("DELETE FROM orders WHERE id = ?").bind(orderId).run();
  // Child rows may predate their tables on an old database; missing is fine.
  await db.prepare("DELETE FROM reviews WHERE order_id = ?").bind(orderId).run().catch(() => undefined);
  await db.prepare("DELETE FROM order_actions WHERE order_id = ?").bind(orderId).run().catch(() => undefined);
  await db.prepare("DELETE FROM review_tokens WHERE order_id = ?").bind(orderId).run().catch(() => undefined);

  return {
    objectKeys: [row.preview_object_key, row.original_object_key].filter((key): key is string => Boolean(key)),
  };
}

/** Statuses that mean the shop still owes the customer a drawing. */
const OPEN_STATUSES = "'new', 'working', 'notification_failed'";

/**
 * Orders a shop is still holding. Completed and cancelled ones free their slot,
 * so capacity reflects work in hand rather than work ever taken.
 *
 * notification_failed counts too: the order exists and shows up in the shop's
 * order list, only the Discord ping did not land. Leaving it out would let a
 * shop keep taking work it has already agreed to.
 */
export async function countActiveOrders(shopId: string) {
  await ensureOrdersTable();
  const row = await getD1().then((db) => db.prepare(
    `SELECT COUNT(*) AS count FROM orders WHERE shop_id = ? AND status IN (${OPEN_STATUSES})`,
  ).bind(shopId).first<{ count: number }>()).catch(() => null);
  return row?.count ?? 0;
}

/** Same figure for every shop at once, for listings. */
export async function countActiveOrdersByShop(): Promise<Map<string, number>> {
  await ensureOrdersTable();
  const rows = await getD1().then((db) => db.prepare(
    `SELECT shop_id, COUNT(*) AS count FROM orders WHERE status IN (${OPEN_STATUSES}) GROUP BY shop_id`,
  ).all<{ shop_id: string; count: number }>()).catch(() => ({ results: [] }));
  return new Map(rows.results.map((row) => [row.shop_id, row.count]));
}

/**
 * The order this customer already has open at this shop, if any.
 *
 * One at a time per shop: a second order while the first is still being drawn
 * is nearly always a double submit or someone jumping the queue. Finishing or
 * cancelling the first frees them to order again, so this limits how much work
 * one person can hold rather than how many times they may come back.
 */
export async function findOpenOrderFor(shopId: string, playerUuid: string) {
  await ensureOrdersTable();
  if (!playerUuid) return null;
  const row = await getD1().then((db) => db.prepare(
    `SELECT id, status, created_at FROM orders
      WHERE shop_id = ? AND player_uuid = ? AND status IN (${OPEN_STATUSES})
      ORDER BY created_at ASC LIMIT 1`,
  ).bind(shopId, playerUuid).first<{ id: string; status: string; created_at: string }>())
    .catch(() => null);
  return row ? { id: row.id, status: row.status, createdAt: row.created_at } : null;
}
