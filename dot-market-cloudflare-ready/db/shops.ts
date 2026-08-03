import { DEFAULT_PRICING, PricingConfig } from "./pricing";

type ShopRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  about_title: string;
  about_text: string;
  manager_email: string;
  webhook_ciphertext: string | null;
  webhook_iv: string | null;
  channel_id: string | null;
  tile_price: number;
  day_1_multiplier: number;
  day_2_multiplier: number;
  day_3_multiplier: number;
  day_4_multiplier: number;
  day_5_multiplier: number;
  day_6_multiplier: number;
  day_7_multiplier: number;
  active: number;
  created_at: string;
  updated_at: string;
};

type ShopImageRow = {
  id: string;
  shop_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  position: number;
  created_at: string;
};

export type ShopImage = {
  id: string;
  filename: string;
  contentType: string;
  position: number;
  url: string;
};

export type PublicShop = {
  id: string;
  slug: string;
  name: string;
  description: string;
  aboutTitle: string;
  aboutText: string;
  images: ShopImage[];
  pricing: PricingConfig;
  /** True once the shop can actually receive orders. */
  webhookConfigured: boolean;
  /** Discord channel the bot posts order notifications to. */
  channelId: string | null;
};

export type ManagedShop = PublicShop & {
  managerEmail: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OrderShop = ManagedShop & {
  webhookCiphertext: string | null;
  webhookIv: string | null;
};

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("샵 데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

async function superAdminEmail() {
  const { env } = await import("cloudflare:workers");
  return typeof env.SUPER_ADMIN_EMAIL === "string"
    ? env.SUPER_ADMIN_EMAIL.trim().toLowerCase()
    : "";
}

export async function isSuperAdmin(email: string) {
  const owner = await superAdminEmail();
  return Boolean(owner) && owner === email.trim().toLowerCase();
}

async function ensureShopsTable() {
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      about_title TEXT NOT NULL DEFAULT '작업 안내',
      about_text TEXT NOT NULL DEFAULT '',
      manager_email TEXT NOT NULL,
      webhook_ciphertext TEXT,
      webhook_iv TEXT,
      tile_price INTEGER NOT NULL DEFAULT 2000,
      day_1_multiplier INTEGER NOT NULL DEFAULT 1550,
      day_2_multiplier INTEGER NOT NULL DEFAULT 1400,
      day_3_multiplier INTEGER NOT NULL DEFAULT 1300,
      day_4_multiplier INTEGER NOT NULL DEFAULT 1200,
      day_5_multiplier INTEGER NOT NULL DEFAULT 1120,
      day_6_multiplier INTEGER NOT NULL DEFAULT 1060,
      day_7_multiplier INTEGER NOT NULL DEFAULT 1000,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS shops_manager_email_idx ON shops (manager_email)"),
    db.prepare("CREATE INDEX IF NOT EXISTS shops_active_idx ON shops (active)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS shop_images (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS shop_images_shop_id_idx ON shop_images (shop_id, position)"),
  ]);

  // Added when order notifications moved from webhooks to the bot.
  await db.prepare("ALTER TABLE shops ADD COLUMN channel_id TEXT").run().catch(() => undefined);

  const owner = await superAdminEmail();
  if (owner) {
    await db.prepare(`INSERT OR IGNORE INTO shops (
      id, slug, name, description, manager_email
    ) VALUES (?, ?, ?, ?, ?)`).bind(
      "default-dot-order-shop",
      "dot-order",
      "DOT ORDER",
      "올린 이미지를 화가 이젤 팔레트로 바꿔 32×32 캔버스 단위로 잘라 드립니다.",
      owner,
    ).run();
  }
}

const selectColumns = `id, slug, name, description, about_title, about_text, manager_email,
  webhook_ciphertext, webhook_iv, channel_id, tile_price,
  day_1_multiplier, day_2_multiplier, day_3_multiplier, day_4_multiplier,
  day_5_multiplier, day_6_multiplier, day_7_multiplier,
  active, created_at, updated_at`;

function rowPricing(row: ShopRow): PricingConfig {
  return {
    tilePrice: row.tile_price,
    deadlineMultipliers: {
      "1": row.day_1_multiplier / 1000,
      "2": row.day_2_multiplier / 1000,
      "3": row.day_3_multiplier / 1000,
      "4": row.day_4_multiplier / 1000,
      "5": row.day_5_multiplier / 1000,
      "6": row.day_6_multiplier / 1000,
      "7": row.day_7_multiplier / 1000,
    },
  };
}

function toImage(row: ShopImageRow): ShopImage {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    position: row.position,
    url: `/api/shop-images/${row.id}`,
  };
}

async function listImages(shopId: string): Promise<ShopImage[]> {
  const rows = await getD1().then((db) => db.prepare(`SELECT id, shop_id,
    object_key, filename, content_type, position, created_at
    FROM shop_images WHERE shop_id = ? ORDER BY position ASC, created_at ASC`
  ).bind(shopId).all<ShopImageRow>());
  return rows.results.map(toImage);
}

function toManagedShop(row: ShopRow, images: ShopImage[] = []): ManagedShop {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    aboutTitle: row.about_title,
    aboutText: row.about_text,
    images,
    managerEmail: row.manager_email,
    pricing: rowPricing(row),
    channelId: row.channel_id,
    // Orders go out through the bot now, so a channel is what makes a shop
    // reachable. The name is kept so existing callers keep working.
    webhookConfigured: Boolean(row.channel_id),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOrderShop(row: ShopRow): OrderShop {
  return {
    ...toManagedShop(row),
    webhookCiphertext: row.webhook_ciphertext,
    webhookIv: row.webhook_iv,
  };
}

export async function listPublicShops(): Promise<PublicShop[]> {
  await ensureShopsTable();
  const rows = await getD1().then((db) => db.prepare(
    `SELECT ${selectColumns} FROM shops WHERE active = 1 ORDER BY created_at ASC`,
  ).all<ShopRow>());
  return Promise.all(rows.results.map(async (row) => toManagedShop(row, await listImages(row.id))));
}

export async function getPublicShop(slug: string): Promise<PublicShop | null> {
  await ensureShopsTable();
  const row = await getD1().then((db) => db.prepare(
    `SELECT ${selectColumns} FROM shops WHERE slug = ? AND active = 1`,
  ).bind(slug).first<ShopRow>());
  return row ? toManagedShop(row, await listImages(row.id)) : null;
}

export async function listAllShops(): Promise<ManagedShop[]> {
  await ensureShopsTable();
  const rows = await getD1().then((db) => db.prepare(
    `SELECT ${selectColumns} FROM shops ORDER BY created_at ASC`,
  ).all<ShopRow>());
  return Promise.all(rows.results.map(async (row) => toManagedShop(row, await listImages(row.id))));
}

export async function listManagedShops(email: string): Promise<ManagedShop[]> {
  if (await isSuperAdmin(email)) return listAllShops();
  await ensureShopsTable();
  const rows = await getD1().then((db) => db.prepare(
    `SELECT ${selectColumns} FROM shops WHERE lower(manager_email) = lower(?) ORDER BY created_at ASC`,
  ).bind(email.trim()).all<ShopRow>());
  return Promise.all(rows.results.map(async (row) => toManagedShop(row, await listImages(row.id))));
}

export async function getShopForManager(id: string, email: string) {
  await ensureShopsTable();
  const row = await getD1().then((db) => db.prepare(
    `SELECT ${selectColumns} FROM shops WHERE id = ?`,
  ).bind(id).first<ShopRow>());
  if (!row) return null;
  if (!(await isSuperAdmin(email)) && row.manager_email.toLowerCase() !== email.toLowerCase()) {
    return null;
  }
  return toManagedShop(row, await listImages(row.id));
}

export async function getOrderShop(slug: string): Promise<OrderShop | null> {
  await ensureShopsTable();
  const row = await getD1().then((db) => db.prepare(
    `SELECT ${selectColumns} FROM shops WHERE slug = ? AND active = 1`,
  ).bind(slug).first<ShopRow>());
  return row ? toOrderShop(row) : null;
}

export function validSlug(slug: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 3 && slug.length <= 50;
}

export function validPricing(value: unknown): value is PricingConfig {
  if (!value || typeof value !== "object") return false;
  const pricing = value as PricingConfig;
  if (!Number.isInteger(pricing.tilePrice) || pricing.tilePrice < 100 || pricing.tilePrice > 1_000_000) return false;
  return [1, 2, 3, 4, 5, 6, 7].every((day) => {
    const multiplier = pricing.deadlineMultipliers?.[String(day)];
    return typeof multiplier === "number" && multiplier >= 1 && multiplier <= 10;
  });
}

export async function createShop(input: {
  slug: string;
  name: string;
  description: string;
  managerEmail: string;
}) {
  await ensureShopsTable();
  const id = crypto.randomUUID();
  await getD1().then((db) => db.prepare(`INSERT INTO shops (
    id, slug, name, description, manager_email,
    tile_price, day_1_multiplier, day_2_multiplier, day_3_multiplier,
    day_4_multiplier, day_5_multiplier, day_6_multiplier, day_7_multiplier
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id,
    input.slug,
    input.name,
    input.description,
    input.managerEmail.toLowerCase(),
    DEFAULT_PRICING.tilePrice,
    ...[1, 2, 3, 4, 5, 6, 7].map((day) =>
      Math.round(DEFAULT_PRICING.deadlineMultipliers[String(day)] * 1000),
    ),
  ).run());
  const shops = await listAllShops();
  return shops.find((shop) => shop.id === id)!;
}

export async function updateShopSettings(id: string, input: {
  name: string;
  description: string;
  aboutTitle: string;
  aboutText: string;
  pricing: PricingConfig;
  channelId?: string | null;
}) {
  await ensureShopsTable();
  const multipliers = [1, 2, 3, 4, 5, 6, 7].map((day) =>
    Math.round(input.pricing.deadlineMultipliers[String(day)] * 1000),
  );
  const db = await getD1();
  if (input.channelId !== undefined) {
    await db.prepare(`UPDATE shops SET name = ?, description = ?, about_title = ?, about_text = ?, tile_price = ?,
      day_1_multiplier = ?, day_2_multiplier = ?, day_3_multiplier = ?,
      day_4_multiplier = ?, day_5_multiplier = ?, day_6_multiplier = ?,
      day_7_multiplier = ?, channel_id = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
      input.name, input.description, input.aboutTitle, input.aboutText, input.pricing.tilePrice, ...multipliers,
      input.channelId, id,
    ).run();
  } else {
    await db.prepare(`UPDATE shops SET name = ?, description = ?, about_title = ?, about_text = ?, tile_price = ?,
      day_1_multiplier = ?, day_2_multiplier = ?, day_3_multiplier = ?,
      day_4_multiplier = ?, day_5_multiplier = ?, day_6_multiplier = ?,
      day_7_multiplier = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
      input.name, input.description, input.aboutTitle, input.aboutText, input.pricing.tilePrice, ...multipliers, id,
    ).run();
  }
}

export async function addShopImage(input: {
  shopId: string;
  objectKey: string;
  filename: string;
  contentType: string;
}) {
  await ensureShopsTable();
  const id = crypto.randomUUID();
  const db = await getD1();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM shop_images WHERE shop_id = ?")
    .bind(input.shopId).first<{ count: number }>();
  if ((count?.count ?? 0) >= 10) throw new Error("이미지는 샵당 최대 10장까지 올릴 수 있습니다.");
  const position = count?.count ?? 0;
  await db.prepare(`INSERT INTO shop_images
    (id, shop_id, object_key, filename, content_type, position)
    VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, input.shopId, input.objectKey, input.filename, input.contentType, position).run();
  return { id, position };
}

export async function removeShopImage(shopId: string, imageId: string) {
  await ensureShopsTable();
  const db = await getD1();
  const image = await db.prepare(`SELECT id, shop_id, object_key, filename,
    content_type, position, created_at FROM shop_images WHERE id = ? AND shop_id = ?`
  ).bind(imageId, shopId).first<ShopImageRow>();
  if (!image) return null;
  await db.prepare("DELETE FROM shop_images WHERE id = ? AND shop_id = ?")
    .bind(imageId, shopId).run();
  return image.object_key;
}

export async function getPublicImageObjectKey(imageId: string) {
  await ensureShopsTable();
  const row = await getD1().then((db) => db.prepare(`SELECT i.object_key
    FROM shop_images i JOIN shops s ON s.id = i.shop_id
    WHERE i.id = ? AND s.active = 1`
  ).bind(imageId).first<{ object_key: string }>());
  return row?.object_key ?? null;
}

export async function getShopImageObjectKey(shopId: string, imageId: string) {
  await ensureShopsTable();
  const row = await getD1().then((db) => db.prepare(`SELECT object_key
    FROM shop_images WHERE id = ? AND shop_id = ?`
  ).bind(imageId, shopId).first<{ object_key: string }>());
  return row?.object_key ?? null;
}

export async function countShopOrders(shopId: string) {
  await ensureShopsTable();
  const row = await getD1().then((db) =>
    db.prepare("SELECT COUNT(*) AS count FROM orders WHERE shop_id = ?").bind(shopId).first<{ count: number }>(),
  ).catch(() => null);
  return row?.count ?? 0;
}

/**
 * Removes a shop and everything that hangs off it.
 *
 * Orders are read through `JOIN shops`, so deleting only the shop row would
 * make its orders vanish from every screen while their rows and R2 objects
 * stayed behind forever. Collect the object keys first, then delete rows in
 * child-to-parent order, and hand the keys back so the caller can purge R2.
 */
export async function deleteShopCascade(id: string) {
  await ensureShopsTable();
  const db = await getD1();

  const shop = await db.prepare(`SELECT ${selectColumns} FROM shops WHERE id = ?`).bind(id).first<ShopRow>();
  if (!shop) return null;

  const images = await db.prepare("SELECT object_key FROM shop_images WHERE shop_id = ?")
    .bind(id).all<{ object_key: string }>();

  // The orders table may not exist yet on a database that has never taken one.
  const orders = await db.prepare(
    "SELECT preview_object_key, original_object_key FROM orders WHERE shop_id = ?",
  ).bind(id).all<{ preview_object_key: string; original_object_key: string | null }>().catch(() => ({ results: [] }));

  const objectKeys = [
    ...images.results.map((row) => row.object_key),
    ...orders.results.flatMap((row) => [row.preview_object_key, row.original_object_key]),
  ].filter((key): key is string => Boolean(key));

  await db.batch([
    db.prepare("DELETE FROM shop_images WHERE shop_id = ?").bind(id),
    db.prepare("DELETE FROM shops WHERE id = ?").bind(id),
  ]);
  await db.prepare("DELETE FROM orders WHERE shop_id = ?").bind(id).run().catch(() => undefined);

  return {
    slug: shop.slug,
    name: shop.name,
    imageCount: images.results.length,
    orderCount: orders.results.length,
    objectKeys,
  };
}

export async function updateShopControl(id: string, input: {
  managerEmail: string;
  active: boolean;
}) {
  await ensureShopsTable();
  await getD1().then((db) => db.prepare(`UPDATE shops SET
    manager_email = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(input.managerEmail.toLowerCase(), input.active ? 1 : 0, id).run());
}
