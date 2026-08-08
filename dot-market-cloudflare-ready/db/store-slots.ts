/**
 * How many copies of a product are still on offer.
 *
 * A licensed product is not sold from stock — what limits it is how many
 * licences the owner is willing to have live at once. So the count comes from
 * the licence server: every key registered there fills a slot, except the ones
 * on the exempt list (the maker's own key, testers, staff). The owner can also
 * fill slots by hand for anything agreed elsewhere.
 *
 * Import-free so the page, the panel and the route all read the same rules.
 */

export type StoreSlotState = {
  /** False when the owner has the limit switched off; show nothing. */
  enabled: boolean;
  max: number;
  /** Live licences on the licence server, minus the exempt ones. */
  auto: number;
  /** Slots the owner filled by hand. */
  manual: number;
  used: number;
  free: number;
  full: boolean;
  /**
   * True when the licence server could not be reached, so `auto` is the last
   * figure we knew rather than today's. Ordering is never blocked on a guess.
   */
  stale: boolean;
};

export function storeSlotState(input: {
  slotOn: boolean;
  slotMax: number;
  slotManual: number;
  licences: number;
  stale?: boolean;
}): StoreSlotState {
  const max = Math.max(0, Math.trunc(input.slotMax) || 0);
  const manual = Math.max(0, Math.trunc(input.slotManual) || 0);
  const auto = Math.max(0, Math.trunc(input.licences) || 0);
  const used = auto + manual;
  const enabled = input.slotOn && max > 0;
  return {
    enabled,
    max,
    auto,
    manual,
    used,
    free: Math.max(0, max - used),
    // A stale count can be short, so it must not be what turns people away.
    full: enabled && !input.stale && used >= max,
    stale: Boolean(input.stale),
  };
}

/**
 * Keys that do not take a slot, one per line.
 *
 * Written as either the bare key or `닉네임(KEY)`, because that is how the
 * owner lists them elsewhere and retyping is how mistakes happen.
 */
export function parseExemptKeys(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[\n,]/)
    .map((line) => {
      const inside = /\(([^)]*)\)/.exec(line);
      return (inside ? inside[1] : line).trim().toUpperCase();
    })
    .filter((key) => key.length > 0);
}

/** Counts the licences that take a slot. */
export function countChargeable(keys: string[], exempt: string[]) {
  const skip = new Set(exempt);
  return keys.filter((key) => !skip.has(key.trim().toUpperCase())).length;
}
