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

/** How many pictures one product may carry. */
export const MAX_ITEM_IMAGES = 8;

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

const DURATION_UNITS: [RegExp, number][] = [
  [/년|연/, 365],
  [/개월|달/, 30],
  [/주일?/, 7],
  [/일|day/i, 1],
];

/**
 * How long a plan lasts, read out of its label.
 *
 * Labels are the owner's own words, so this is a best guess: "2주일" is 14 days,
 * "평생" is nothing it can count. 0 means "do not add this to a total" rather
 * than "zero days", and callers treat it that way.
 */
export function parseDurationDays(label: string) {
  const text = String(label ?? "").trim();
  const amount = Number(text.match(/\d+/)?.[0] ?? 1);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  for (const [pattern, days] of DURATION_UNITS) {
    if (pattern.test(text)) return amount * days;
  }
  return 0;
}

/** "1년 2개월" reads better than "425일" once the number gets big. */
export function durationLabel(days: number) {
  if (days <= 0) return "";
  if (days < 30) return `${days}일`;
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  if (years > 0) return months > 0 ? `${years}년 ${months}개월` : `${years}년`;
  const rest = days % 30;
  return rest > 0 ? `${months}개월 ${rest}일` : `${months}개월`;
}

/** The colour a discount is drawn in when the owner has not picked one. */
export const DEFAULT_SALE_COLOUR = "#FF5A4E";

/** A few colours that read as "look here", so picking one is a click. */
export const SALE_COLOURS = [
  { hex: "#FF5A4E", name: "빨강" },
  { hex: "#F2721B", name: "주황" },
  { hex: "#E4B300", name: "노랑" },
  { hex: "#2FA84F", name: "초록" },
  { hex: "#1E88E5", name: "파랑" },
  { hex: "#7A4DD8", name: "보라" },
  { hex: "#D6336C", name: "분홍" },
  { hex: "#16151A", name: "검정" },
];

/**
 * Anything that is not a plain #rrggbb falls back to the default. The value
 * reaches the page as inline style, so it has to be exactly a colour.
 */
export function normaliseColour(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) return DEFAULT_SALE_COLOUR;
  return text.toUpperCase();
}

/**
 * Black or white, whichever stays legible on the given background. Without it a
 * yellow badge would be white text on yellow.
 */
export function readableOn(hex: string) {
  const colour = normaliseColour(hex);
  const channel = (at: number) => {
    const part = parseInt(colour.slice(at, at + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.42 ? "#16151A" : "#FFFFFF";
}
