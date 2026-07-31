import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicShop } from "../../../../db/shops";
import AboutGallery from "./gallery";

export const dynamic = "force-dynamic";

export default async function ShopAboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await getPublicShop(slug);
  if (!shop) notFound();

  return (
    <main className="shop-about-page">
      <header className="topbar service-topbar">
        <Link className="brand" href="/" aria-label="샵 목록으로 이동">
          <span className="brand-mark"><i/><i/><i/><i/></span><span>DOT MARKET</span>
        </Link>
        <nav aria-label="샵 메뉴">
          <Link href={`/shop/${shop.slug}`}>주문 제작</Link>
          <Link className="active" href={`/shop/${shop.slug}/about`}>작품 설명</Link>
        </nav>
        <Link className="admin-link" href="/admin">관리자</Link>
      </header>

      <div className="service-breadcrumb"><Link href="/">전체 샵</Link><span>/</span><b>{shop.name}</b></div>
      <section className="service-overview">
        <AboutGallery images={shop.images} shopName={shop.name}/>
        <aside className="service-summary">
          <span className="service-category">PIXEL COMMISSION</span>
          <h1>{shop.aboutTitle || `${shop.name} 작업 안내`}</h1>
          <p className="service-by">by {shop.name}</p>
          <p className="service-short-copy">{shop.description || "사진을 32×32 단위의 도트 작품으로 제작합니다."}</p>
          <dl>
            <div><dt>기본 가격</dt><dd>32×32 한 장당 <b>{shop.pricing.tilePrice.toLocaleString("ko-KR")}원</b></dd></div>
            <div><dt>마감 선택</dt><dd>1일 ~ 7일</dd></div>
            <div><dt>결과 확인</dt><dd>변환 도안 PNG 제공</dd></div>
          </dl>
          <Link className="service-order-link" href={`/shop/${shop.slug}`}>이 샵에서 주문 제작하기 <span>→</span></Link>
          {!shop.webhookConfigured && <small className="service-preparing-note">현재 샵 관리자가 주문 알림을 준비하고 있습니다.</small>}
        </aside>
      </section>

      <section className="service-description-section">
        <div className="service-description-label"><span>ABOUT THIS WORK</span><h2>작품 설명</h2></div>
        <div className="service-description-copy">
          {shop.aboutText ? shop.aboutText.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>) : <>
            <p>업로드한 이미지를 전용 색상으로 변환하고, 32×32 크기의 정사각형 단위로 정확하게 나누어 제작합니다.</p>
            <p>주문 화면에서 원하는 가로 크기와 마감 일정을 선택하면 최종 규격과 예상 가격을 바로 확인할 수 있습니다.</p>
          </>}
        </div>
      </section>

      <footer className="service-footer"><span>{shop.name}</span><Link href={`/shop/${shop.slug}`}>주문 제작으로 이동</Link></footer>
    </main>
  );
}
