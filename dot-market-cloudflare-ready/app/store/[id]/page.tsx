import Link from "next/link";
import { notFound } from "next/navigation";
import { getItem, hasPurchases, slotsForItem, withoutLicence } from "../../../db/store";
import { getItemRating, listItemReviews } from "../../../db/store-reviews";
import { getUser } from "../../session";
import { SITE } from "../../site-content";
import BuyPanel from "./buy";
import Shots from "./shots";
import CountView from "../../count-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getItem(id).catch(() => null);
  return { title: item?.name ?? "상품" };
}

export default async function StoreItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Stripped here: everything on this page is serialised to the browser, and
  // the terms are for people who have actually bought the thing.
  const item = await getItem(id).then((found) => found && withoutLicence(found)).catch(() => null);
  // A switched-off product is not visible just because someone kept the link.
  if (!item || !item.active || item.plans.length === 0) notFound();

  const [user, rating, reviews] = await Promise.all([
    getUser().catch(() => null),
    getItemRating(item.id).catch(() => ({ average: 0, count: 0, sold: 0 })),
    listItemReviews(item.id).catch(() => []),
  ]);
  const bought = user ? await hasPurchases(user.id).catch(() => false) : false;
  const slots = await slotsForItem(item).catch(() => null);

  return (
    <div className="market-page">
      <CountView event="store_item"/>
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
          {bought && <Link className="licence-link" href="/store/licence">이용 안내</Link>}
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

                {slots?.enabled && (
                  <div className={`slot-bar${slots.full ? " is-full" : ""}`}>
                    <div className="slot-bar-head">
                      <span>남은 자리</span>
                      <b>{slots.full ? "마감" : `${slots.free}자리`}</b>
                    </div>
                    <div className="slot-track" role="img" aria-label={`${slots.max}자리 중 ${slots.used}자리 사용`}>
                      <i style={{ width: `${Math.min(100, (slots.used / slots.max) * 100)}%` }}/>
                    </div>
                    <small>{slots.max}자리 중 {slots.used}자리 나갔습니다.</small>
                  </div>
                )}

                <BuyPanel
                  item={item}
                  signedIn={Boolean(user)}
                  buyerName={user?.name ?? ""}
                  soldOut={Boolean(slots?.full)}
                />

                <ol className="store-detail-how">
                  <li>구매를 누르면 운영자에게 알림이 갑니다.</li>
                  <li>게임에 접속해 인게임 머니를 주고받습니다.</li>
                  <li>모드 파일과 라이선스 코드를 디스코드로 보내드립니다.</li>
                </ol>
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
