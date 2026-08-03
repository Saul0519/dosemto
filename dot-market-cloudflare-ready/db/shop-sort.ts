/**
 * How the market list is ordered, and how much of it is shown at once.
 *
 * Sorting happens here rather than in SQL because two of the keys — the rating
 * and the review count — live in a different table, and the shop count on this
 * site is small enough that one grouped read plus a sort in memory beats a join
 * that has to be kept in step with the review rules.
 */

export type ShopSort = "recommended" | "rating" | "reviews" | "newest" | "random";

export const SHOP_SORTS: { key: ShopSort; label: string; hint: string }[] = [
  { key: "recommended", label: "추천순", hint: "지금 주문할 수 있고 평이 좋은 샵부터" },
  { key: "rating", label: "별점 높은 순", hint: "평균 별점이 높은 순" },
  { key: "reviews", label: "후기 많은 순", hint: "후기가 많이 달린 순" },
  { key: "newest", label: "최근 등록된 순", hint: "늦게 문 연 샵부터" },
  { key: "random", label: "랜덤", hint: "볼 때마다 순서가 바뀝니다" },
];

export const SHOPS_PER_PAGE = 12;

export function parseSort(value: string | undefined): ShopSort {
  return SHOP_SORTS.some((sort) => sort.key === value) ? value as ShopSort : "recommended";
}

export function parsePage(value: string | undefined) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 1 ? page : 1;
}

type Sortable = {
  id: string;
  createdAt: string;
  /** True when an order placed right now would actually reach someone. */
  orderable: boolean;
  rating: { average: number; count: number; completedOrders: number };
};

/**
 * Pulls an average toward the site-wide mean until a shop has enough reviews to
 * have earned its position. Without this a single five-star review outranks a
 * shop with forty reviews averaging 4.8, which is the wrong answer for someone
 * deciding where to spend money.
 */
const CONFIDENCE = 5;

function bayesian(rating: Sortable["rating"], siteMean: number) {
  return (CONFIDENCE * siteMean + rating.average * rating.count) / (CONFIDENCE + rating.count);
}

function siteMeanRating(shops: Sortable[]) {
  const rated = shops.filter((shop) => shop.rating.count > 0);
  if (rated.length === 0) return 0;
  const total = rated.reduce((sum, shop) => sum + shop.rating.average * shop.rating.count, 0);
  const count = rated.reduce((sum, shop) => sum + shop.rating.count, 0);
  return total / count;
}

const newestFirst = (a: Sortable, b: Sortable) => b.createdAt.localeCompare(a.createdAt);

export function sortShops<T extends Sortable>(shops: T[], sort: ShopSort, seed: number): T[] {
  const ordered = [...shops];

  if (sort === "random") {
    // Fisher-Yates off a caller-supplied seed, so the order a visitor sees on
    // page 1 is the same order page 2 continues from.
    let state = seed || 1;
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
    return ordered;
  }

  if (sort === "newest") return ordered.sort(newestFirst);

  if (sort === "reviews") {
    return ordered.sort((a, b) =>
      b.rating.count - a.rating.count
      || b.rating.average - a.rating.average
      || newestFirst(a, b));
  }

  if (sort === "rating") {
    return ordered.sort((a, b) =>
      // A shop nobody has reviewed has no rating to be high, so it sits below
      // every shop that has one rather than tying at zero.
      Number(b.rating.count > 0) - Number(a.rating.count > 0)
      || b.rating.average - a.rating.average
      || b.rating.count - a.rating.count
      || newestFirst(a, b));
  }

  const mean = siteMeanRating(ordered);
  return ordered.sort((a, b) =>
    // Somewhere you cannot order is the least useful result on the page,
    // however good its reviews are.
    Number(b.orderable) - Number(a.orderable)
    || bayesian(b.rating, mean) - bayesian(a.rating, mean)
    || b.rating.completedOrders - a.rating.completedOrders
    || newestFirst(a, b));
}
