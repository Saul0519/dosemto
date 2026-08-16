import { BASE_DEADLINE, RUSH_DEADLINE } from "./deadlines";
import { LoyaltyTier, parseTiers, serialiseTiers } from "./loyalty";
import { SizeSurcharge, parseSurcharges, serialiseSurcharges } from "./size-surcharge";
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
  premium: number;
  loyalty_tiers: string | null;
  size_surcharges: string | null;
  size_surcharge_on: number;
  accept_channel_id: string | null;
  reject_channel_id: string | null;
  complete_channel_id: string | null;
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
  /** When the shop opened. Public because the market list can sort by it. */
  createdAt: string;
  /** Paid placement badge. Public by design — the point is that it shows. */
  premium: boolean;
  /** What this shop calls its repeat customers, and from how many orders. */
  loyaltyTiers: LoyaltyTier[];
  /** Bands of extra charge for large pictures. Only applied when switched on. */
  sizeSurcharges: SizeSurcharge[];
  sizeSurchargeOn: boolean;
};

export type ManagedShop = PublicShop & {
  managerEmail: string;
  active: boolean;
  updatedAt: string;
  /**
   * Channels for each outcome, each falling back to the order channel. Only on
   * the managed shape: a customer has no use for them, and PublicShop is handed
   * whole to the order screen's client component.
   */
  acceptChannelId: string | null;
  rejectChannelId: string | null;
  completeChannelId: string | null;
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
  // A paid badge, shown on the card. Public and meant to be seen.
  await db.prepare("ALTER TABLE shops ADD COLUMN premium INTEGER NOT NULL DEFAULT 0").run().catch(() => undefined);
  // Hand-set position in the recommended list. Deliberately NOT part of any
  // shop type — see listFeatureRanks.
  await db.prepare("ALTER TABLE shops ADD COLUMN feature_rank INTEGER NOT NULL DEFAULT 0").run().catch(() => undefined);
  // Titles the shop gives its repeat customers, as JSON. Null means defaults.
  await db.prepare("ALTER TABLE shops ADD COLUMN loyalty_tiers TEXT").run().catch(() => undefined);
  // Extra per canvas on large pictures, and whether the shop charges it at all.
  await db.prepare("ALTER TABLE shops ADD COLUMN size_surcharges TEXT").run().catch(() => undefined);
  await db.prepare("ALTER TABLE shops ADD COLUMN size_surcharge_on INTEGER NOT NULL DEFAULT 0").run().catch(() => undefined);
  // Where each outcome is announced. Null means "wherever orders go".
  for (const column of ["accept_channel_id", "reject_channel_id", "complete_channel_id"]) {
    await db.prepare(`ALTER TABLE shops ADD COLUMN ${column} TEXT`).run().catch(() => undefined);
  }

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
  webhook_ciphertext, webhook_iv, channel_id, guild_id, slot_max, slot_manual,
  premium, loyalty_tiers, size_surcharges, size_surcharge_on,
  accept_channel_id, reject_channel_id, complete_channel_id, tile_price,
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
 * Images for many shops in one query, keyed by shop.
 *
 * Plain position order. Everything downstream — the market card, the gallery's
 * opening frame — reads index 0, so the cover is simply whichever picture the
 * manager dragged to the front.
 *
 * The list screens used to call listImages once per shop, which is a round trip
 * each.
 */
async function listImagesByShop(
  shops: { id: string }[],
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
  return byShop;
}

async function listImages(shopId: string): Promise<ShopImage[]> {
  const rows = await getD1().then((db) => db.prepare(`SELECT id, shop_id,
    object_key, filename, content_type, position, created_at
    FROM shop_images WHERE shop_id = ?
    ORDER BY position ASC, created_at ASC`
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
    acceptChannelId: row.accept_channel_id,
    rejectChannelId: row.reject_channel_id,
    completeChannelId: row.complete_channel_id,
    pricing: rowPricing(row),
    channelId: row.channel_id,
    guildId: row.guild_id,
    slotMax: row.slot_max ?? 0,
    slotManual: row.slot_manual ?? 0,
    premium: Boolean(row.premium),
    loyaltyTiers: parseTiers(row.loyalty_tiers),
    sizeSurcharges: parseSurcharges(row.size_surcharges),
    sizeSurchargeOn: Boolean(row.size_surcharge_on),
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

/**
 * Drops everything a customer has no business seeing.
 *
 * toManagedShop builds the full row, and a `Promise<PublicShop>` annotation
 * prunes nothing at run time — the object still carries the manager's email and
 * the shop's channel ids. The order screen is a client component, so every
 * property it is handed is serialised into the page. The manager's email is the
 * identity that gets into /admin, so publishing it hands out the guest list.
 *
 * Built by removing, not by copying: a field added to ManagedShop later stays
 * out of here on its own, and one added to PublicShop is not silently dropped.
 */
export function toPublicShop(shop: ManagedShop): PublicShop {
  // Naming them is how they are dropped, so being unused is the whole point.
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    managerEmail: _email,
    active: _active,
    updatedAt: _updated,
    acceptChannelId: _accept,
    rejectChannelId: _reject,
    completeChannelId: _complete,
    channelId: _channel,
    guildId: _guild,
    ...rest
  } = shop;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  // The two the customer's screen never reads, blanked rather than removed so
  // the shape still matches PublicShop.
  return { ...rest, channelId: null, guildId: null };
}

export async function listPublicShops(): Promise<PublicShop[]> {
  await ensureShopsTable();
  const rows = await getD1().then((db) => db.prepare(
    `SELECT ${selectColumns} FROM shops WHERE active = 1 ORDER BY created_at ASC`,
  ).all<ShopRow>());
  const images = await listImagesByShop(rows.results);
  return rows.results.map((row) => toPublicShop(toManagedShop(row, images.get(row.id) ?? [])));
}

export async function getPublicShop(slug: string): Promise<PublicShop | null> {
  await ensureShopsTable();
  const row = await getD1().then((db) => db.prepare(
    `SELECT ${selectColumns} FROM shops WHERE slug = ? AND active = 1`,
  ).bind(slug).first<ShopRow>());
  return row ? toPublicShop(toManagedShop(row, await listImages(row.id))) : null;
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
  if (!Number.isInteger(pricing.tilePrice) || pricing.tilePrice < 100 || pricing.tilePrice > 10_000_000) return false;
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
  loyaltyTiers: LoyaltyTier[];
  sizeSurcharges: SizeSurcharge[];
  sizeSurchargeOn: boolean;
  channelId?: string | null;
  /** Undefined leaves a channel as it was; an empty value clears it. */
  acceptChannelId?: string | null;
  rejectChannelId?: string | null;
  completeChannelId?: string | null;
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

  const loyaltyTiers = serialiseTiers(input.loyaltyTiers ?? []);
  const sizeSurcharges = serialiseSurcharges(input.sizeSurcharges ?? []);
  const sizeSurchargeOn = input.sizeSurchargeOn ? 1 : 0;

  // Written separately from the main UPDATE so "leave as is" stays possible for
  // each one without four variants of the statement.
  for (const [column, value] of [
    ["accept_channel_id", input.acceptChannelId],
    ["reject_channel_id", input.rejectChannelId],
    ["complete_channel_id", input.completeChannelId],
  ] as const) {
    if (value === undefined) continue;
    await db.prepare(`UPDATE shops SET ${column} = ? WHERE id = ?`).bind(value || null, id).run();
  }

  if (input.channelId !== undefined) {
    await db.prepare(`UPDATE shops SET name = ?, description = ?, about_title = ?, about_text = ?, tile_price = ?,
      day_1_multiplier = ?, day_2_multiplier = ?, day_3_multiplier = ?,
      day_4_multiplier = ?, day_5_multiplier = ?, day_6_multiplier = ?,
      day_7_multiplier = ?, channel_id = ?, slot_max = ?, slot_manual = ?, loyalty_tiers = ?,
      size_surcharges = ?, size_surcharge_on = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
      input.name, input.description, input.aboutTitle, input.aboutText, input.pricing.tilePrice, ...multipliers,
      input.channelId, slotMax, slotManual, loyaltyTiers, sizeSurcharges, sizeSurchargeOn, id,
    ).run();
  } else {
    await db.prepare(`UPDATE shops SET name = ?, description = ?, about_title = ?, about_text = ?, tile_price = ?,
      day_1_multiplier = ?, day_2_multiplier = ?, day_3_multiplier = ?,
      day_4_multiplier = ?, day_5_multiplier = ?, day_6_multiplier = ?,
      day_7_multiplier = ?, slot_max = ?, slot_manual = ?, loyalty_tiers = ?,
      size_surcharges = ?, size_surcharge_on = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
      input.name, input.description, input.aboutTitle, input.aboutText, input.pricing.tilePrice, ...multipliers,
      slotMax, slotManual, loyaltyTiers, sizeSurcharges, sizeSurchargeOn, id,
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

/**
 * Writes a new order for a shop's pictures.
 *
 * Ids that are not this shop's are dropped and any the caller left out keep
 * their place at the end, so a stale list cannot move another shop's pictures
 * or lose one uploaded a moment ago.
 */
export async function reorderShopImages(shopId: string, orderedIds: string[]) {
  await ensureShopsTable();
  const db = await getD1();
  const rows = await db.prepare(
    "SELECT id FROM shop_images WHERE shop_id = ? ORDER BY position ASC, created_at ASC",
  ).bind(shopId).all<{ id: string }>().catch(() => ({ results: [] as { id: string }[] }));

  const existing: string[] = rows.results.map((row: { id: string }) => row.id);
  const mine = new Set(existing);
  const asked = orderedIds.filter((id) => mine.has(id));
  const seen = new Set(asked);
  const settled = [...asked, ...existing.filter((id) => !seen.has(id))];
  if (settled.length === 0) return false;

  await db.batch(settled.map((id, at) =>
    db.prepare("UPDATE shop_images SET position = ? WHERE id = ? AND shop_id = ?").bind(at, id, shopId)));
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

  const reviews = await db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE shop_id = ?")
    .bind(id).first<{ count: number }>().catch(() => null);
  // Photos customers attached to their reviews are stored files like any other.
  const reviewImages = await db.prepare(
    "SELECT image_key FROM reviews WHERE shop_id = ? AND image_key IS NOT NULL",
  ).bind(id).all<{ image_key: string }>().catch(() => ({ results: [] as { image_key: string }[] }));

  const objectKeys = [
    ...images.results.map((row) => row.object_key),
    ...orders.results.flatMap((row) => [row.preview_object_key, row.original_object_key]),
    ...reviewImages.results.map((row) => row.image_key),
  ].filter((key): key is string => Boolean(key));

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

/**
 * Hand-set positions in the recommended list, by shop id.
 *
 * Loaded on its own rather than hung off a shop object on purpose. PublicShop
 * is handed whole to the order screen's client component, and ManagedShop to
 * the admin panel, so a field on either would be sitting in the page source for
 * anyone who looked — and the point of this ordering is that it does not
 * announce itself. Two callers only: the market list's sort, and /control.
 */
export async function listFeatureRanks(): Promise<Map<string, number>> {
  await ensureShopsTable();
  const rows = await getD1().then((db) => db.prepare(
    "SELECT id, feature_rank FROM shops WHERE feature_rank > 0",
  ).all<{ id: string; feature_rank: number }>()).catch(() => ({ results: [] as { id: string; feature_rank: number }[] }));
  return new Map(rows.results.map((row) => [row.id, row.feature_rank] as [string, number]));
}

export async function updateShopControl(id: string, input: {
  managerEmail: string;
  active: boolean;
  premium: boolean;
  /** 0 leaves the shop to be ranked on its own merits. */
  featureRank: number;
}) {
  await ensureShopsTable();
  const featureRank = Math.max(0, Math.min(999, Math.trunc(input.featureRank) || 0));
  await getD1().then((db) => db.prepare(`UPDATE shops SET
    manager_email = ?, active = ?, premium = ?, feature_rank = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(
    input.managerEmail.toLowerCase(),
    input.active ? 1 : 0,
    input.premium ? 1 : 0,
    featureRank,
    id,
  ).run());
}

/** The shop already using this Discord server, if any. */
export async function shopUsingGuild(guildId: string) {
  await ensureShopsTable();
  const db = await getD1();
  const row = await db.prepare("SELECT id FROM shops WHERE guild_id = ? LIMIT 1")
    .bind(guildId).first<{ id: string }>().catch(() => null);
  return row?.id ?? null;
}

/** Records the server a shop's manager just invited the bot to. */
export async function setShopGuild(id: string, guildId: string) {
  await ensureShopsTable();
  await getD1().then((db) =>
    db.prepare("UPDATE shops SET guild_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(guildId, id).run(),
  );
}
