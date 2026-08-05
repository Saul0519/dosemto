import Link from "next/link";
import { listActiveItems } from "../../db/store";
import { getUser } from "../session";
import { SITE } from "../site-content";
import StoreList from "./list";

export const dynamic = "force-dynamic";

export const metadata = { title: "상점" };

export default async function StorePage() {
  const [items, user] = await Promise.all([
    listActiveItems().catch(() => []),
    getUser().catch(() => null),
  ]);

  return (
    <div className="market-page">
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
        <section className="market-section" id="store">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">STORE</p>
              <h2>상점</h2>
              <p>
                게임 안 화폐로 사는 기간제 상품입니다. 사이트에서는 결제하지 않습니다 —
                구매를 누르면 운영자에게 알림이 가고, 거래는 게임 안에서 이뤄집니다.
              </p>
            </div>

            {items.length === 0 ? (
              <div className="empty-shops">
                <b>지금은 판매 중인 상품이 없습니다.</b>
                <span>상품이 올라오면 여기 표시됩니다.</span>
              </div>
            ) : (
              <StoreList items={items} signedIn={Boolean(user)} buyerName={user?.name ?? ""}/>
            )}
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
