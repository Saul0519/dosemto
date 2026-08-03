import { BASE_DEADLINE, RUSH_DEADLINE } from "./deadlines";
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
  guild_id: string | null;
  slot_max: number | null;
  slot_manual: number | null;
  tile_price: number;
  day_1_multiplier: number;
  day_2_multiplier: number;
  day_3_multiplier: number;
  day_4_multiplier: number;
  day_5_multiplier: number;
  day_6_multiplier: number;
  day_7_multiplier: number;
  cover_image_id: string | null;
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
  /** Server the bot was invited to for this shop. */
  guildId: string | null;
  /** How many jobs the shop is willing to hold at once. 0 means no limit. */
  slotMax: number;
  /** Slots the manager filled by hand, for work taken outside the site. */
  slotManual: number;
  /** Image the manager picked to represent the shop; null means "the first one". */
  coverImageId: string | null;
  /** When the shop opened. Public because the market list can sort by it. */
  createdAt: string;
};

export type ManagedShop = PublicShop & {
  managerEmail: string;
  active: boolean;
  updatedAt: string;
};

/** Nothing extra any more: order notifications go through the bot. */
export type OrderShop = ManagedShop;

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

/**
 * Schema setup, once per isolate rather than once per query.
 *
 * Every helper in this file called this first, so a single page view replayed
 * the CREATEs and ALTERs dozens of times. Each statement is cheap on its own,
 * but each one is also a round trip to D1, and that is what the site felt like.
 * A failure clears the latch so the next request retries rather than running
 * against a half-built schema.
 */
let migrateShopsTableReady: Promise<void> | null = null;

async function ensureShopsTable() {
  if (!migrateShopsTableReady) {
    migrateShopsTableReady = migrateShopsTable().catch((error) => { migrateShopsTableReady = null; throw error; });
  }
  return migrateShopsTableReady;
}

async function migrateShopsTable() {
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
  await db.prepare("ALTER TABLE shops ADD COLUMN guild_id TEXT").run().catch(() => undefined);
  // Capacity the shop advertises, and the part of it filled by hand.
  await db.prepare("ALTER TABLE shops ADD COLUMN slot_max INTEGER NOT NULL DEFAULT 0").run().catch(() => undefined);
  await db.prepare("ALTER TABLE shops ADD COLUMN slot_manual INTEGER NOT NULL DEFAULT 0").run().catch(() => undefined);
  // Which uploaded image represents the shop. Null falls back to position order.
  await db.prepare("ALTER TABLE shops ADD COLUMN cover_image_id TEXT").run().catch(() => undefined);

  await seedDefaultShopOnce(db);
}

/**
 * Creates the starter shop the very first time this database is used.
 *
 * It has to be once and only once. This ran on every call before, so deleting
 * the starter shop in the control panel appeared to work and then the next
 * request put it straight back — INSERT OR IGNORE only skips a row that is
 * still there. The marker is what makes the deletion stick.
 */
async function seedDefaultShopOnce(db: Awaited<ReturnType<typeof getD1>>) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS site_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  ).run();

  const done = await db.prepare("SELECT value FROM site_meta WHERE key = 'default_shop_seeded'")
    .first<{ value: string }>().catch(() => null);
  if (done) return;

  const owner = await superAdminEmail();
  if (!owner) return;

  // A database that already has shops predates this marker; record that the
  // seed is settled rather than adding a starter shop to a live site.
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM shops")
    .first<{ count: number }>().catch(() => null);
  // Not knowing the count is not the same as knowing it is zero. Guessing here
  // would put the starter shop back on a site that deliberately removed it,
  // which is the whole failure this marker exists to prevent. Try again later.
  if (!existing) return;

  if (existing.count === 0) {
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

  await db.prepare(
    "INSERT OR REPLACE INTO site_meta (key, value) VALUES ('default_shop_seeded', ?)",
  ).bind(new Date().toISOString()).run();
}

const selectColumns = `id, slug, name, description, about_title, about_text, manager_email,
  webhook_ciphertext, webhook_iv, channel_id, guild_id, slot_max, slot_manual, cover_image_id, tile_price,
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

/**
 * Images newest-last, except the one the manager picked as the cover, which
 * always comes first. Everything downstream — the market card, the gallery's
 * opening frame — reads index 0, so choosing a cover is just this ordering.
 *
 * A cover_image_id left pointing at a deleted image simply matches nothing and
 * the list falls back to position order.
 */
/**
 * Images for many shops in one query, keyed by shop.
 *
 * The list screens used to call listImages once per shop, which is a round trip
 * each. Cover ordering is applied per shop here rather than in SQL, since the
 * rows for every shop come back together.
 */
async function listImagesByShop(
  shops: { id: string; cover_image_id: string | null }[],
): Promise<Map<string, ShopImage[]>> {
  const byShop = new Map<string, ShopImage[]>(shops.map((shop) => [shop.id, []]));
  if (shops.length === 0) return byShop;

  const placeholders = shops.map(() => "?").join(", ");
  const rows = await getD1().then((db) => db.prepare(`SELECT id, shop_id,
    object_key, filename, content_type, position, created_at
    FROM shop_images WHERE shop_id IN (${placeholders})
    ORDER BY position ASC, created_at ASC`
  ).bind(...shops.map((shop) => shop.id)).all<ShopImageRow>()).catch(() => ({ results: [] }));

  for (const row of rows.results) byShop.get(row.shop_id)?.push(toImage(row));
  for (const shop of shops) {
    if (!shop.cover_image_id) continue;
    const images = byShop.get(shop.id);
    const at = images?.findIndex((image) => image.id === shop.cover_image_id) ?? -1;
    if (images && at > 0) images.unshift(images.splice(at, 1)[0]);
  }
  return byShop;
}

async function listImages(shopId: string): Promise<ShopImage[]> {
  const rows = await getD1().then((db) => db.prepare(`SELECT id, shop_id,
    object_key, filename, content_type, position, created_at
    FROM shop_images WHERE shop_id = ?
    ORDER BY id = (SELECT cover_image_id FROM shops WHERE id = ?) DESC,
      position ASC, created_at ASC`
  ).bind(shopId, shopId).all<ShopImageRow>());
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
    guildId: row.guild_id,
    slotMax: row.slot_max ?? 0,
    slotManual: row.slot_manual ?? 0,
    coverImageId: row.cover_image_id ?? null,
    // Orders go out through the bot now, so a channel is what makes a shop
    // reachable. The name is kept so existing callers keep working.
    webhookConfigured: Boolean(row.channel_id),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOrderShop(row: ShopRow): OrderShop {
  return toManagedShop(row);
}

export async function listPublicShops(): Promise<PublicShop[]> {
  await ensureShopsTable();
  const rows = await getD1().then((db) => db.prepare(
    `SELECT ${selectColumns} FROM shops WHERE active = 1 ORDER BY created_at ASC`,
  ).all<ShopRow>());
  const images = await listImagesByShop(rows.results);
  return rows.results.map((row) => toManagedShop(row, images.get(row.id) ?? []));
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
  const images = await listImagesByShop(rows.results);
  return rows.results.map((row) => toManagedShop(row, images.get(row.id) ?? []));
}

export async function listManagedShops(email: string): Promise<ManagedShop[]> {
  if (await isSuperAdmin(email)) return listAllShops();
  await ensureShopsTable();
  const rows = await getD1().then((db) => db.prepare(
    `SELECT ${selectColumns} FROM shops WHERE lower(manager_email) = lower(?) ORDER BY created_at ASC`,
  ).bind(email.trim()).all<ShopRow>());
  const images = await listImagesByShop(rows.results);
  return rows.results.map((row) => toManagedShop(row, images.get(row.id) ?? []));
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
  // Only the two turnarounds a shop can actually offer are required; the other
  // columns are filled from the base rate on write.
  return [RUSH_DEADLINE, BASE_DEADLINE].every((day) => {
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
  /** Required, not optional: omitting these would silently reset the queue. */
  slotMax: number;
  slotManual: number;
}) {
  await ensureShopsTable();
  // Rush keeps its own rate; every other day column carries the base rate, so a
  // value left over from the seven-day scheme cannot resurface later.
  const rush = input.pricing.deadlineMultipliers[String(RUSH_DEADLINE)];
  const base = input.pricing.deadlineMultipliers[String(BASE_DEADLINE)];
  const multipliers = [1, 2, 3, 4, 5, 6, 7].map((day) =>
    Math.round((day === RUSH_DEADLINE ? rush : base) * 1000),
  );
  const db = await getD1();

  // Slots are always written; channel only when the caller supplied one, so a
  // blank field in the form means "keep what is there".
  const slotMax = Math.max(0, Math.min(999, Math.trunc(input.slotMax) || 0));
  const slotManual = Math.max(0, Math.min(999, Math.trunc(input.slotManual) || 0));

  if (input.channelId !== undefined) {
    await db.prepare(`UPDATE shops SET name = ?, description = ?, about_title = ?, about_text = ?, tile_price = ?,
      day_1_multiplier = ?, day_2_multiplier = ?, day_3_multiplier = ?,
      day_4_multiplier = ?, day_5_multiplier = ?, day_6_multiplier = ?,
      day_7_multiplier = ?, channel_id = ?, slot_max = ?, slot_manual = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
      input.name, input.description, input.aboutTitle, input.aboutText, input.pricing.tilePrice, ...multipliers,
      input.channelId, slotMax, slotManual, id,
    ).run();
  } else {
    await db.prepare(`UPDATE shops SET name = ?, description = ?, about_title = ?, about_text = ?, tile_price = ?,
      day_1_multiplier = ?, day_2_multiplier = ?, day_3_multiplier = ?,
      day_4_multiplier = ?, day_5_multiplier = ?, day_6_multiplier = ?,
      day_7_multiplier = ?, slot_max = ?, slot_manual = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
      input.name, input.description, input.aboutTitle, input.aboutText, input.pricing.tilePrice, ...multipliers,
      slotMax, slotManual, id,
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
  const tail = await db.prepare(
    "SELECT COUNT(*) AS count, MAX(position) AS last FROM shop_images WHERE shop_id = ?",
  ).bind(input.shopId).first<{ count: number; last: number | null }>();
  if ((tail?.count ?? 0) >= 10) throw new Error("이미지는 샵당 최대 10장까지 올릴 수 있습니다.");
  // One past the highest position, not the row count. Deleting images leaves
  // gaps, and counting rows used to hand a new upload a position that already
  // existed — sometimes 0, which quietly made it the shop's cover.
  const position = (tail?.last ?? -1) + 1;
  await db.prepare(`INSERT INTO shop_images
    (id, shop_id, object_key, filename, content_type, position)
    VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, input.shopId, input.objectKey, input.filename, input.contentType, position).run();
  return { id, position };
}

/** Marks one of the shop's own images as its cover. */
export async function setShopCoverImage(shopId: string, imageId: string) {
  await ensureShopsTable();
  const db = await getD1();
  const image = await db.prepare("SELECT id FROM shop_images WHERE id = ? AND shop_id = ?")
    .bind(imageId, shopId).first<{ id: string }>();
  if (!image) return false;
  await db.prepare("UPDATE shops SET cover_image_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(imageId, shopId).run();
  return true;
}

export async function removeShopImage(shopId: string, imageId: string) {
  await ensureShopsTable();
  const db = await getD1();
  const image = await db.prepare(`SELECT id, shop_id, object_key, filename,
    content_type, position, created_at FROM shop_images WHERE id = ? AND shop_id = ?`
  ).bind(imageId, shopId).first<ShopImageRow>();
  if (!image) return null;
  await db.batch([
    db.prepare("DELETE FROM shop_images WHERE id = ? AND shop_id = ?").bind(imageId, shopId),
    // Otherwise the shop keeps pointing at an image that is gone.
    db.prepare("UPDATE shops SET cover_image_id = NULL WHERE id = ? AND cover_image_id = ?")
      .bind(shopId, imageId),
  ]);
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

  const reviews = await db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE shop_id = ?")
    .bind(id).first<{ count: number }>().catch(() => null);

  await db.batch([
    db.prepare("DELETE FROM shop_images WHERE shop_id = ?").bind(id),
    db.prepare("DELETE FROM shops WHERE id = ?").bind(id),
  ]);

  // Everything hanging off the shop's orders. Each table is optional on a
  // database that never had one, so they run separately rather than in a batch
  // where one missing table would roll the whole thing back. Reviews go with
  // the shop: a review of a shop nobody can visit is not a record of anything,
  // and leaving them would strand rows that no screen can ever reach again.
  for (const statement of [
    "DELETE FROM reviews WHERE shop_id = ?",
    "DELETE FROM order_actions WHERE order_id IN (SELECT id FROM orders WHERE shop_id = ?)",
    "DELETE FROM review_tokens WHERE order_id IN (SELECT id FROM orders WHERE shop_id = ?)",
    "DELETE FROM orders WHERE shop_id = ?",
  ]) {
    await db.prepare(statement).bind(id).run().catch(() => undefined);
  }

  return {
    slug: shop.slug,
    name: shop.name,
    imageCount: images.results.length,
    orderCount: orders.results.length,
    reviewCount: reviews?.count ?? 0,
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

/** Records the server a shop's manager just invited the bot to. */
export async function setShopGuild(id: string, guildId: string) {
  await ensureShopsTable();
  await getD1().then((db) =>
    db.prepare("UPDATE shops SET guild_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(guildId, id).run(),
  );
}
