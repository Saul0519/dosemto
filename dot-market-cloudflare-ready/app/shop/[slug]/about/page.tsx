import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { countActiveOrders } from "../../../../db/orders";
import { getPublicShop } from "../../../../db/shops";
import { slotState } from "../../../../db/slots";
import { countHiddenReviews, getShopRating, listShopReviews } from "../../../../db/reviews";
import { SHOP_PAGE, SITE } from "../../../site-content";
import AccountChip from "../../../account-chip";
import { getUser } from "../../../session";
import AboutGallery from "./gallery";

export const dynamic = "force-dynamic";

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getPublicShop(slug).catch(() => null);
  if (!shop) return { title: "샵을 찾을 수 없습니다" };
  return {
    title: shop.name,
    // Collapsed: a description may hold the line breaks a manager typed,
    // which mean nothing inside a meta attribute.
    description: shop.description.replace(/\s+/g, " ").trim() || SITE.description,
  };
}

export default async function ShopAboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await getPublicShop(slug);
  if (!shop) notFound();

  const user = await getUser().catch(() => null);
  const [rating, reviews, hiddenCount, activeOrders] = await Promise.all([
    getShopRating(shop.id).catch(() => ({ average: 0, count: 0, completedOrders: 0 })),
    listShopReviews(shop.id).catch(() => []),
    countHiddenReviews(shop.id).catch(() => 0),
    countActiveOrders(shop.id).catch(() => 0),
  ]);
  const slots = slotState(shop, activeOrders);

  // A blank line starts a new paragraph; a single Enter stays a line break
  // inside the current one. Managers type in a plain textarea and expect both.
  const about = shop.aboutText
    ? shop.aboutText.split(/\n{2,}/).map((block) => block.split("\n"))
    : SHOP_PAGE.defaultAbout.map((block) => [block]);

  return (
    <div className="shop-about-page">
      <header className="topbar service-topbar">
        <Link className="brand" href="/" aria-label="샵 목록으로 이동">
          <span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>
          <span>{SITE.name}</span>
        </Link>
        <nav className="market-nav" aria-label="샵 메뉴">
          <Link href={`/shop/${shop.slug}`}>주문 제작</Link>
          <Link className="active" href={`/shop/${shop.slug}/about`}>샵 소개</Link>
        </nav>
        <AccountChip userName={user?.name ?? null} next={`/shop/${shop.slug}/about`}/>
        <Link className="admin-link" href="/admin">샵 관리자</Link>
      </header>

      <main>
        <nav className="service-breadcrumb" aria-label="위치">
          <Link href="/">전체 샵</Link><span aria-hidden="true">/</span><b>{shop.name}</b>
        </nav>

        <section className="service-overview">
          <AboutGallery images={shop.images} shopName={shop.name}/>

          <aside className="service-summary">
            <span className="service-category">{SHOP_PAGE.specTitle}</span>
            <h1>{shop.aboutTitle || `${shop.name} 도안 주문`}</h1>
            <p className="service-by">by {shop.name}</p>
            {rating.count > 0 && (
              <a className="service-rating" href="#reviews">
                <b aria-hidden="true">{"★".repeat(Math.round(rating.average))}<i>{"★".repeat(5 - Math.round(rating.average))}</i></b>
                <strong>{rating.average.toFixed(1)}</strong>
                <span>({rating.count})</span>
                <small>완료 주문 {rating.completedOrders}건</small>
                <em>후기 보기</em>
              </a>
            )}
            <p className="service-short-copy multiline">
              {shop.description || "올린 이미지를 화가 이젤 팔레트로 바꿔 32×32 캔버스 단위로 잘라 드립니다."}
            </p>
            <dl>
              <div><dt>캔버스</dt><dd>한 장 32 × 32</dd></div>
              <div><dt>장당</dt><dd><b>{won(shop.pricing.tilePrice)}</b> · 장수 × 마감 배수</dd></div>
              <div><dt>마감</dt><dd>기본 또는 당일 마감</dd></div>
              <div><dt>받는 것</dt><dd>32px 격자선이 들어간 도안 PNG</dd></div>
              <div><dt>연락</dt><dd>주문 시 남긴 디스코드 ID</dd></div>
              {slots.enabled && (
                <div><dt>접수 슬롯</dt><dd>{slots.full ? `가득 참 (${slots.used}/${slots.max})` : `${slots.used}/${slots.max} · ${slots.free}칸 남음`}</dd></div>
              )}
            </dl>
            <Link className="service-order-link" href={`/shop/${shop.slug}`}>
              {SHOP_PAGE.cta} <span aria-hidden="true">→</span>
            </Link>
            {shop.webhookConfigured && slots.full && (
              <small className="service-preparing-note">
                지금은 접수 슬롯이 모두 찼습니다. 진행 중인 작업이 끝나면 다시 열립니다. 도안 변환과 다운로드는 그대로 쓰실 수 있습니다.
              </small>
            )}
            {!shop.webhookConfigured && (
              <small className="service-preparing-note">
                이 샵은 아직 주문 알림 채널을 연결하지 않아 지금은 주문을 받을 수 없습니다. 도안 변환과 다운로드는 됩니다.
              </small>
            )}
          </aside>
        </section>

        <section className="service-description-section">
          <div className="wrap">
            <div className="service-description-label">
              <span>ABOUT THIS SHOP</span>
              <h2>{SHOP_PAGE.aboutTitle}</h2>
            </div>
            <div className="service-description-copy">
              {about.map((lines, index) => (
                <p key={index}>
                  {lines.map((line, lineIndex) => (
                    <span key={lineIndex}>
                      {lineIndex > 0 && <br/>}
                      {line}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          </div>
        </section>

        <section className="market-section" id="reviews" aria-labelledby="reviews-title">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">REVIEWS</p>
              <h2 id="reviews-title">주문한 사람들의 후기</h2>
              <p>
                {rating.count > 0
                  ? `이 샵에서 마감된 주문 ${rating.completedOrders}건 중 ${rating.count}건에 후기가 달렸습니다. 후기는 주문한 본인만 쓰고 고칠 수 있습니다.`
                  : "아직 후기가 없습니다. 작업이 마감되면 주문한 분이 후기를 남길 수 있습니다."}
              </p>
              {hiddenCount > 0 && (
                <p className="hidden-note">
                  사이트 운영자가 숨긴 후기 {hiddenCount}건이 있습니다. 숨겨도 이 숫자는 남습니다.
                </p>
              )}
            </div>
            {reviews.length > 0 && (
              <ul className="review-list">
                {reviews.map((review) => (
                  <li key={review.id}>
                    <div className="review-head">
                      <b aria-label={`${review.rating}점`}>{"★".repeat(review.rating)}<span>{"★".repeat(5 - review.rating)}</span></b>
                      <span>{review.displayName}</span>
                      <time dateTime={review.createdAt}>{review.createdAt.slice(0, 10)}</time>
                    </div>
                    {review.body && <p>{review.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <footer className="service-footer">
        <div className="wrap">
          <span>{shop.name} · {SITE.domain}</span>
          <Link href={`/shop/${shop.slug}`}>주문 화면으로 이동</Link>
          <p className="site-disclaimer">{SITE.disclaimer}</p>
        </div>
      </footer>
    </div>
  );
}
