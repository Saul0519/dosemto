import Link from "next/link";
import { notFound } from "next/navigation";
import { getItem } from "../../../db/store";
import { getItemRating, listItemReviews } from "../../../db/store-reviews";
import { readableOn } from "../../../db/store-plans";
import { getUser } from "../../session";
import { SITE } from "../../site-content";
import BuyPanel from "./buy";
import Shots from "./shots";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getItem(id).catch(() => null);
  return { title: item?.name ?? "상품" };
}

export default async function StoreItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getItem(id).catch(() => null);
  // A switched-off product is not visible just because someone kept the link.
  if (!item || !item.active || item.plans.length === 0) notFound();

  const [user, rating, reviews] = await Promise.all([
    getUser().catch(() => null),
    getItemRating(item.id).catch(() => ({ average: 0, count: 0, sold: 0 })),
    listItemReviews(item.id).catch(() => []),
  ]);

  return (
    <div
      className="market-page"
      style={{ "--sale": item.saleColour, "--on-sale": readableOn(item.saleColour) } as React.CSSProperties}
    >
      <header className="market-header">
        <div className="wrap">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>
            <span>{SITE.name}</span>
          </Link>
          <nav className="market-nav" aria-label="주요 메뉴">
            <Link href="/">마켓</Link>
            <Link className="active" href="/store">상점</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="market-section">
          <div className="wrap">
            <p className="back-link"><Link href="/store">← 상점으로</Link></p>

            <div className="store-detail">
              <div className="store-detail-main">
                {item.images.length > 0
                  ? <Shots images={item.images} name={item.name}/>
                  : <div className="store-shot-empty"><span className="lattice"/><b>아직 사진이 없습니다.</b></div>}

                {item.detail && <div className="store-detail-text">{item.detail}</div>}
              </div>

              <aside className="store-detail-side">
                {item.tagline && <p className="store-tagline">{item.tagline}</p>}
                <h1>{item.name}</h1>
                {item.description && <p className="store-desc">{item.description}</p>}

                <p className="store-detail-stats">
                  {rating.count > 0
                    ? <a href="#store-reviews">★ {rating.average.toFixed(1)} · 후기 {rating.count}개</a>
                    : <span>아직 후기가 없습니다</span>}
                  {rating.sold > 0 && <span>· 판매 {rating.sold}건</span>}
                </p>

                <BuyPanel item={item} signedIn={Boolean(user)} buyerName={user?.name ?? ""}/>

                <p className="store-detail-how">
                  사이트에서 결제하지 않습니다. 구매 요청을 넣으면 운영자가 연락해 인게임 머니를
                  받고, 모드 파일과 라이선스 코드를 디스코드로 보내드립니다.
                </p>
              </aside>
            </div>

            <div className="store-reviews" id="store-reviews">
              <div className="control-list-head">
                <h2>구매 후기</h2>
                <span>{reviews.length === 0 ? "첫 후기를 기다리는 중" : `${reviews.length}개`}</span>
              </div>

              {reviews.length === 0 ? (
                <p className="field-help">받아보신 분이 후기를 남기면 여기 표시됩니다.</p>
              ) : (
                <ul className="store-review-list">
                  {reviews.map((review) => (
                    <li key={review.id}>
                      <div className="store-review-head">
                        <b>{review.displayName}</b>
                        {review.purchaseIndex > 0 && <em>{review.purchaseIndex}번째 구매</em>}
                        {review.heldFor && <i>누적 {review.heldFor}</i>}
                        {/* Hollow stars rather than dimmed solid ones: the score
                            still reads right if the stylesheet never arrives. */}
                        <span className="store-review-stars" aria-label={`5점 만점에 ${review.rating}점`}>
                          {"★".repeat(review.rating)}<s>{"☆".repeat(5 - review.rating)}</s>
                        </span>
                        <time dateTime={review.updatedAt}>{review.updatedAt.slice(0, 10)}</time>
                      </div>
                      {review.body && <p>{review.body}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="market-footer">
        <div className="wrap">
          <span>{SITE.name} · {SITE.domain}</span>
          <p className="site-disclaimer">{SITE.disclaimer}</p>
        </div>
      </footer>
    </div>
  );
}
