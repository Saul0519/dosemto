import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "../../session";
import { listPurchasesForUser } from "../../../db/store";
import { won } from "../../../db/store-plans";
import { SITE } from "../../site-content";

export const dynamic = "force-dynamic";

export const metadata = { title: "내 이용 안내", robots: { index: false, follow: false } };

/**
 * Every notice this person holds.
 *
 * With one purchase there is nothing to choose between, so it goes straight to
 * the document. The list only earns its place once there are several.
 */
export default async function MyLicencesPage() {
  const user = await getUser().catch(() => null);
  if (!user) redirect(`/login?next=${encodeURIComponent("/store/licence")}`);

  const purchases = await listPurchasesForUser(user.id).catch(() => []);
  if (purchases.length === 1) redirect(`/store/licence/${purchases[0].orderNo}`);

  return (
    <main className="action-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>
          <span>{SITE.name}</span>
        </Link>
      </header>

      <div className="action-shell action-shell-wide">
        <div className="section-head">
          <p className="eyebrow">TERMS OF USE</p>
          <h2>내 이용 안내</h2>
          <p>구매하신 상품의 안내문입니다. 본인 계정에서만 보입니다.</p>
        </div>

        {purchases.length === 0 ? (
          <div className="empty-shops">
            <b>아직 구매하신 상품이 없습니다.</b>
            <span>상점에서 상품을 구매하시면 이용 안내가 여기에 남습니다.</span>
            <Link className="btn btn-line" href="/store">상점 둘러보기</Link>
          </div>
        ) : (
          <ul className="licence-list">
            {purchases.map((purchase) => (
              <li key={purchase.id}>
                <Link href={`/store/licence/${purchase.orderNo}`}>
                  <b>{purchase.itemName}</b>
                  <span>
                    <code>{purchase.orderNo}</code>
                    {purchase.planLabel} · {won(purchase.price)}
                  </span>
                  <time dateTime={purchase.createdAt}>{purchase.createdAt.slice(0, 10)}</time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
