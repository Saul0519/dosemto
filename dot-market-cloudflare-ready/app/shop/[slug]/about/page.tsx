import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicShop } from "../../../../db/shops";
import { SHOP_PAGE, SITE } from "../../../site-content";
import AboutGallery from "./gallery";

export const dynamic = "force-dynamic";

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getPublicShop(slug).catch(() => null);
  if (!shop) return { title: "샵을 찾을 수 없습니다" };
  return {
    title: shop.name,
    description: shop.description || SITE.description,
  };
}

export default async function ShopAboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await getPublicShop(slug);
  if (!shop) notFound();

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
            <p className="service-short-copy">
              {shop.description || "올린 이미지를 화가 이젤 팔레트로 바꿔 32×32 캔버스 단위로 잘라 드립니다."}
            </p>
            <dl>
              <div><dt>캔버스</dt><dd>한 장 32 × 32</dd></div>
              <div><dt>장당</dt><dd><b>{won(shop.pricing.tilePrice)}</b> · 장수 × 마감 배수</dd></div>
              <div><dt>마감</dt><dd>1일 ~ 7일 · 7일이 기본가</dd></div>
              <div><dt>받는 것</dt><dd>32px 격자선이 들어간 도안 PNG</dd></div>
              <div><dt>연락</dt><dd>주문 시 남긴 디스코드 ID</dd></div>
            </dl>
            <Link className="service-order-link" href={`/shop/${shop.slug}`}>
              {SHOP_PAGE.cta} <span aria-hidden="true">→</span>
            </Link>
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
      </main>

      <footer className="service-footer">
        <div className="wrap">
          <span>{shop.name} · {SITE.domain}</span>
          <Link href={`/shop/${shop.slug}`}>주문 화면으로 이동</Link>
        </div>
      </footer>
    </div>
  );
}
