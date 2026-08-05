import Link from "next/link";
import { StoreItem } from "../../db/store";
import { ItemRating } from "../../db/store-reviews";
import { discountPercent, effectivePrice, isOnSale, readableOn, won } from "../../db/store-plans";

/**
 * The grid is a set of doorways, not a checkout. Each card shows the cheapest
 * way in and how loud the discount is; everything else lives on the product's
 * own page, which is where buying happens.
 */
export default function StoreList({ items, ratings }: {
  items: StoreItem[];
  ratings: Map<string, ItemRating>;
}) {
  return (
    <div className="store-grid">
      {items.map((item) => {
        const cheapest = item.plans.reduce((low, plan) =>
          effectivePrice(plan) < effectivePrice(low) ? plan : low, item.plans[0]);
        const best = item.plans.reduce((most, plan) =>
          discountPercent(plan) > discountPercent(most) ? plan : most, item.plans[0]);
        const rating = ratings.get(item.id);
        const cover = item.images[0];

        return (
          <Link
            className="store-card"
            key={item.id}
            href={`/store/${item.id}`}
            style={{ "--sale": item.saleColour, "--on-sale": readableOn(item.saleColour) } as React.CSSProperties}
          >
            <div className="store-card-shot">
              {cover
                ? <img src={`/api/store-images/${cover.id}`} alt={item.name} loading="lazy"/>
                : <span className="store-card-blank" aria-hidden="true"><i/><i/><i/><i/></span>}
              {isOnSale(best) && <b className="store-sale-badge">{discountPercent(best)}% 할인</b>}
            </div>

            <div className="store-card-body">
              {item.tagline && <p className="store-tagline">{item.tagline}</p>}
              <h3>{item.name}</h3>
              {item.description && <p className="store-desc">{item.description}</p>}

              <div className="store-card-foot">
                <span className="store-card-price">
                  {isOnSale(cheapest) && <s>{won(cheapest.price)}</s>}
                  <strong>{won(effectivePrice(cheapest))}</strong>
                  <small>{cheapest.label}부터</small>
                </span>
                {rating && rating.count > 0 && (
                  <span className="store-card-rating">★ {rating.average.toFixed(1)} · 후기 {rating.count}</span>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
