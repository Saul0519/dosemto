export type PricingConfig = {
  tilePrice: number;
  deadlineMultipliers: Record<string, number>;
};

export const DEFAULT_PRICING: PricingConfig = {
  tilePrice: 2000,
  deadlineMultipliers: {
    "1": 1.55,
    "2": 1.4,
    "3": 1.3,
    "4": 1.2,
    "5": 1.12,
    "6": 1.06,
    "7": 1,
  },
};

type PriceRow = {
  tile_price: number;
  day_1_multiplier: number;
  day_2_multiplier: number;
  day_3_multiplier: number;
  day_4_multiplier: number;
  day_5_multiplier: number;
  day_6_multiplier: number;
  day_7_multiplier: number;
};

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("가격 데이터베이스가 아직 연결되지 않았습니다.");
  return env.DB;
}

async function ensurePricingTable() {
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS price_settings (
      id INTEGER PRIMARY KEY,
      tile_price INTEGER NOT NULL DEFAULT 2000,
      day_1_multiplier INTEGER NOT NULL DEFAULT 1550,
      day_2_multiplier INTEGER NOT NULL DEFAULT 1400,
      day_3_multiplier INTEGER NOT NULL DEFAULT 1300,
      day_4_multiplier INTEGER NOT NULL DEFAULT 1200,
      day_5_multiplier INTEGER NOT NULL DEFAULT 1120,
      day_6_multiplier INTEGER NOT NULL DEFAULT 1060,
      day_7_multiplier INTEGER NOT NULL DEFAULT 1000,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`INSERT OR IGNORE INTO price_settings (
      id, tile_price, day_1_multiplier, day_2_multiplier, day_3_multiplier,
      day_4_multiplier, day_5_multiplier, day_6_multiplier, day_7_multiplier
    ) VALUES (1, 2000, 1550, 1400, 1300, 1200, 1120, 1060, 1000)`),
  ]);
}

function fromRow(row: PriceRow): PricingConfig {
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

export async function getPricing(): Promise<PricingConfig> {
  await ensurePricingTable();
  const db = await getD1();
  const row = await db.prepare(
    `SELECT tile_price, day_1_multiplier, day_2_multiplier, day_3_multiplier,
      day_4_multiplier, day_5_multiplier, day_6_multiplier, day_7_multiplier
    FROM price_settings WHERE id = 1`
  ).first<PriceRow>();
  return row ? fromRow(row) : DEFAULT_PRICING;
}

export async function updatePricing(pricing: PricingConfig): Promise<PricingConfig> {
  await ensurePricingTable();
  const values = [1, 2, 3, 4, 5, 6, 7].map((day) =>
    Math.round((pricing.deadlineMultipliers[String(day)] ?? 1) * 1000)
  );
  const db = await getD1();
  await db.prepare(
    `UPDATE price_settings SET
      tile_price = ?, day_1_multiplier = ?, day_2_multiplier = ?,
      day_3_multiplier = ?, day_4_multiplier = ?, day_5_multiplier = ?,
      day_6_multiplier = ?, day_7_multiplier = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1`
  ).bind(pricing.tilePrice, ...values).run();
  return getPricing();
}
