/**
 * The two turnarounds a shop offers.
 *
 * Deliberately free of imports. The Discord interaction handler in the worker
 * entry needs these labels, and it is bundled without the app's Cloudflare
 * bindings — anything reaching for `cloudflare:workers` from here fails the
 * build rather than at runtime, which is how this file came to exist.
 *
 * The values are the integers the seven-day version already stored, so orders
 * taken under that scheme still read back sensibly: 1 was the most urgent and
 * 7 the standard price. Days 2 to 6 remain in the schema and are no longer
 * offered; deadlineLabel still names them so an old order does not display as
 * something meaningless.
 */

export const RUSH_DEADLINE = 1;
export const BASE_DEADLINE = 7;

export const DEADLINE_CHOICES = [
  { value: BASE_DEADLINE, label: "기본", hint: "샵이 일정에 맞춰 작업합니다" },
  { value: RUSH_DEADLINE, label: "당일 마감", hint: "오늘 안에 받아야 할 때" },
] as const;

export function deadlineLabel(deadline: number) {
  if (deadline === RUSH_DEADLINE) return "당일 마감";
  if (deadline === BASE_DEADLINE) return "기본";
  // Placed while the shop offered a day count.
  return `${deadline}일 마감`;
}

export function isOfferedDeadline(deadline: number) {
  return DEADLINE_CHOICES.some((choice) => choice.value === deadline);
}
