/**
 * Titles a shop gives its repeat customers.
 *
 * Each shop decides the thresholds and what to call them, because "열혈팬" from
 * a shop with three orders a month means something different from one with
 * three a day. Stored as JSON on the shop rather than its own table: it is a
 * short list that is always read and written whole.
 */

export type LoyaltyTier = {
  /** Orders needed, counting completed ones at that shop. */
  count: number;
  label: string;
};

export const MAX_TIERS = 6;

/** Something reasonable for a shop that never touches the setting. */
export const DEFAULT_TIERS: LoyaltyTier[] = [
  { count: 3, label: "단골" },
  { count: 5, label: "열혈팬" },
  { count: 10, label: "회장님" },
];

/**
 * Reads what is stored, tolerating anything. This is JSON in a text column, so
 * it can be older, hand-edited, or absent, and a broken value must not take the
 * shop page down with it.
 */
export function parseTiers(raw: string | null | undefined): LoyaltyTier[] {
  if (!raw) return DEFAULT_TIERS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_TIERS;
  }
  if (!Array.isArray(parsed)) return DEFAULT_TIERS;
  return normaliseTiers(parsed as LoyaltyTier[]);
}

/** Cleaned, ordered and capped — the one place the rules live. */
export function normaliseTiers(tiers: LoyaltyTier[]): LoyaltyTier[] {
  const seen = new Set<number>();
  return tiers
    .map((tier) => ({
      count: Math.trunc(Number(tier?.count) || 0),
      label: String(tier?.label ?? "").trim().slice(0, 20),
    }))
    .filter((tier) => tier.count >= 2 && tier.count <= 9999 && tier.label.length > 0)
    // A repeated threshold would make which title applies depend on order.
    .filter((tier) => !seen.has(tier.count) && seen.add(tier.count))
    .sort((a, b) => a.count - b.count)
    .slice(0, MAX_TIERS);
}

export function serialiseTiers(tiers: LoyaltyTier[]) {
  return JSON.stringify(normaliseTiers(tiers));
}

/** The highest title this many orders has earned, if any. */
export function tierFor(orderCount: number, tiers: LoyaltyTier[]): LoyaltyTier | null {
  let earned: LoyaltyTier | null = null;
  for (const tier of tiers) {
    if (orderCount >= tier.count) earned = tier;
  }
  return earned;
}
