import Link from "next/link";
import { listPublicShops } from "../db/shops";

export const dynamic = "force-dynamic";

export default async function Home() {
  const shops = await listPublicShops().catch(() => []);
  return (
    <main className="market-page">
      <header className="market-header">
        <Link className="brand" href="/">
          <span className="brand-mark"><i/><i/><i/><i/></span>
          <span>DOT MARKET</span>
        </Link>
        <Link className="admin-link" href="/admin">샵 관리자</Link>
      </header>
      <section className="market-hero" aria-labelledby="market-hero-title">
        {/* This custom artwork is decorative; the full message remains in accessible HTML. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="market-hero-art" src="/dot-market-hero-v2.png" alt=""/>
        <div className="market-hero-copy">
          <p className="market-hero-kicker"><span>CURATED</span> PIXEL COMMISSIONS</p>
          <h1 id="market-hero-title">취향을 점으로,<br/><em>작품으로.</em></h1>
          <p className="market-hero-lede">좋아하는 제작자의 세계를 고르고<br/>나만의 픽셀 작업을 의뢰하세요.</p>
          <div className="market-hero-actions">
            <a href="#shops">입점 샵 둘러보기 <span aria-hidden="true">↘</span></a>
            <small><b>{String(shops.length).padStart(2, "0")}</b> INDEPENDENT SHOPS</small>
          </div>
        </div>
        <div className="market-hero-stamp" aria-hidden="true"><span>MADE TO ORDER</span><b>32 × 32</b></div>
      </section>
      <section className="shop-directory" id="shops" aria-label="입점 샵 목록">
        <div className="directory-heading"><h2>입점 샵</h2><span>{shops.length}개 운영 중</span></div>
        <div className="shop-grid">
          {shops.map((shop) => (
            <Link className="shop-card" href={`/shop/${shop.slug}/about`} key={shop.id}>
              <div className="shop-art">
                {shop.images[0] ? <>
                  {/* Shop cover images are uploaded by each shop manager. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shop.images[0].url} alt={`${shop.name} 대표 작업`}/>
                </> : <div className="shop-art-empty"><span>{shop.name.slice(0, 2).toUpperCase()}</span><small>작업 이미지 준비 중</small></div>}
              </div>
              <div className="shop-card-copy">
                <div><small>/{shop.slug}</small><span className={shop.webhookConfigured ? "ready" : "preparing"}>{shop.webhookConfigured ? "주문 가능" : "준비 중"}</span></div>
                <h3>{shop.name}</h3>
                <p>{shop.description || "32×32 격자 작품 주문을 받는 샵입니다."}</p>
                <b>장당 {shop.pricing.tilePrice.toLocaleString("ko-KR")}원부터 <span>상세 보기</span></b>
              </div>
            </Link>
          ))}
          {shops.length === 0 && <div className="empty-shops"><b>아직 공개된 샵이 없습니다.</b><span>총괄 관리자가 첫 샵을 준비하고 있어요.</span></div>}
        </div>
      </section>
      <footer className="market-footer">DOT MARKET · 제작자별 독립 주문 샵</footer>
    </main>
  );
}
