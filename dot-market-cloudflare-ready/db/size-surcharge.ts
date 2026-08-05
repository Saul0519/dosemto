/**
 * Extra charged per canvas once a picture gets large.
 *
 * A shop names its own bands — 대형, 초대형 — because what counts as a big job
 * depends on how the shop works. Each band is a square: "larger than N × N
 * canvases". Grids are not square, so the comparison is against N² total
 * canvases, which is what "N×N 그림을 초과" means when the picture is 3 × 20.
 *
 * Stored as JSON on the shop, like the loyalty titles: a short list that is
 * always read and written whole.
 */

export type SizeSurcharge = {
  /** Applies to a picture of more than size × size canvases. */
  size: number;
  label: string;
  /** Won added to the price of every canvas in the picture. */
  perTile: number;
};

export const MAX_SURCHARGES = 5;

export const DEFAULT_SURCHARGES: SizeSurcharge[] = [
  { size: 5, label: "대형", perTile: 500 },
  { size: 10, label: "초대형", perTile: 1500 },
];

export function parseSurcharges(raw: string | null | undefined): SizeSurcharge[] {
  if (!raw) return DEFAULT_SURCHARGES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SURCHARGES;
  }
  if (!Array.isArray(parsed)) return DEFAULT_SURCHARGES;
  return normaliseSurcharges(parsed as SizeSurcharge[]);
}

/** Cleaned, ordered and capped — the one place the rules live. */
export function normaliseSurcharges(bands: SizeSurcharge[]): SizeSurcharge[] {
  const seen = new Set<number>();
  return bands
    .map((band) => ({
      size: Math.trunc(Number(band?.size) || 0),
      label: String(band?.label ?? "").trim().slice(0, 20),
      perTile: Math.trunc(Number(band?.perTile) || 0),
    }))
    .filter((band) =>
      band.size >= 1 && band.size <= 100
      && band.perTile >= 0 && band.perTile <= 10_000_000
      && band.label.length > 0)
    // Two bands at the same size would make which one applies depend on order.
    .filter((band) => !seen.has(band.size) && seen.add(band.size))
    .sort((a, b) => a.size - b.size)
    .slice(0, MAX_SURCHARGES);
}

export function serialiseSurcharges(bands: SizeSurcharge[]) {
  return JSON.stringify(normaliseSurcharges(bands));
}

/** How many canvases a picture has to beat to fall into this band. */
export function surchargeThreshold(band: SizeSurcharge) {
  return band.size * band.size;
}

/**
 * The band a picture of this many canvases falls into — the largest it clears.
 * Bands do not stack: a picture is 대형 or 초대형, not both.
 */
export function surchargeFor(
  tileCount: number,
  bands: SizeSurcharge[],
  enabled: boolean,
): SizeSurcharge | null {
  if (!enabled) return null;
  let matched: SizeSurcharge | null = null;
  for (const band of bands) {
    if (tileCount > surchargeThreshold(band)) matched = band;
  }
  return matched;
}

/**
 * What an order costs, in one place so the browser's estimate and the price the
 * server records can never drift apart.
 */
export function orderPrice(input: {
  tileCount: number;
  tilePrice: number;
  multiplier: number;
  surcharge: SizeSurcharge | null;
}) {
  const base = input.tileCount * input.tilePrice;
  const extra = input.tileCount * (input.surcharge?.perTile ?? 0);
  // Rounded to the nearest hundred won, the way prices are quoted here.
  const total = Math.round(((base + extra) * input.multiplier) / 100) * 100;
  return { base, extra, total, rush: total - base - extra };
}
