/**
 * How full a shop's queue is.
 *
 * A shop decides how many jobs it will hold at once. Live orders fill that on
 * their own; the manual figure covers work agreed somewhere else, so a shop
 * that takes a commission in DMs can still show itself as busy here. A max of
 * zero means the shop has not set a limit and nothing is ever blocked.
 */

export type SlotState = {
  /** False when the shop set no limit — callers should show nothing. */
  enabled: boolean;
  max: number;
  /** Orders placed here and not yet finished or cancelled. */
  auto: number;
  /** Slots the manager filled by hand. */
  manual: number;
  used: number;
  free: number;
  full: boolean;
};

export function slotState(
  shop: { slotMax?: number | null; slotManual?: number | null },
  auto: number,
): SlotState {
  const max = Math.max(0, shop.slotMax ?? 0);
  const manual = Math.max(0, shop.slotManual ?? 0);
  // Capping at max keeps the bar honest when a manager fills slots by hand and
  // then lowers the limit under what is already taken.
  const used = Math.min(auto + manual, Math.max(max, auto + manual));
  return {
    enabled: max > 0,
    max,
    auto,
    manual,
    used,
    free: Math.max(0, max - used),
    full: max > 0 && used >= max,
  };
}
