/**
 * Price options on a store product.
 *
 * Import-free so both the page and the route can share it. Prices are in-game
 * currency, so they are plain integers with no currency handling — the number
 * on screen is the number the buyer hands over in game.
 */

export type StorePlan = {
  /** "1일", "1주일", "1달" — the shop owner's words, not a fixed set. */
  label: string;
  /** Normal price. */
  price: number;
  /**
   * Discounted price, or 0 for none. Kept alongside rather than replacing the
   * price so the page can show what it was crossed out.
   */
  salePrice: number;
};

export const MAX_PLANS = 8;

export const DEFAULT_PLANS: StorePlan[] = [
  { label: "1일", price: 1_000_000, salePrice: 0 },
  { label: "1주일", price: 5_000_000, salePrice: 0 },
  { label: "1달", price: 18_000_000, salePrice: 0 },
];

export function parsePlans(raw: string | null | undefined): StorePlan[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalisePlans(parsed as StorePlan[]) : [];
  } catch {
    return [];
  }
}

/** Cleaned and capped — the one place the rules live. */
export function normalisePlans(plans: StorePlan[]): StorePlan[] {
  return plans
    .map((plan) => ({
      label: String(plan?.label ?? "").trim().slice(0, 20),
      price: Math.max(0, Math.trunc(Number(plan?.price) || 0)),
      salePrice: Math.max(0, Math.trunc(Number(plan?.salePrice) || 0)),
    }))
    .filter((plan) => plan.label.length > 0 && plan.price > 0)
    // A "discount" that costs more is a mistake, not an offer.
    .map((plan) => (plan.salePrice > 0 && plan.salePrice < plan.price
      ? plan
      : { ...plan, salePrice: 0 }))
    .slice(0, MAX_PLANS);
}

export function serialisePlans(plans: StorePlan[]) {
  return JSON.stringify(normalisePlans(plans));
}

/** What the buyer actually pays. */
export function effectivePrice(plan: StorePlan) {
  return plan.salePrice > 0 ? plan.salePrice : plan.price;
}

export function isOnSale(plan: StorePlan) {
  return plan.salePrice > 0 && plan.salePrice < plan.price;
}

/** "37% 할인" — rounded down so the badge never overstates the saving. */
export function discountPercent(plan: StorePlan) {
  if (!isOnSale(plan)) return 0;
  return Math.floor(((plan.price - plan.salePrice) / plan.price) * 100);
}

export const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
