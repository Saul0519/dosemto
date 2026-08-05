import Link from "next/link";
import { getUser } from "../../../session";
import { getPurchaseByOrderNo } from "../../../../db/store";
import { getReviewForPurchase, reviewableReason } from "../../../../db/store-reviews";
import { won } from "../../../../db/store-plans";
import { SITE } from "../../../site-content";
import StoreReviewForm from "./form";

export const dynamic = "force-dynamic";

export const metadata = { title: "상점 후기", robots: { index: false, follow: false } };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="action-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>
          <span>{SITE.name}</span>
        </Link>
      </header>
      <div className="action-shell">{children}</div>
    </main>
  );
}

export default async function StoreReviewPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const number = decodeURIComponent(orderNo).trim().toUpperCase();
  const user = await getUser().catch(() => null);

  if (!user) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">SIGN IN</p>
          <h1>디스코드로 로그인</h1>
          <p>
            주문 <b>{number}</b>의 후기를 남기려면 그 상품을 구매한 계정으로 로그인해 주세요.
          </p>
          <a className="btn btn-solid" href={`/login?next=${encodeURIComponent(`/store/review/${number}`)}`}>
            디스코드로 로그인 <span className="arrow" aria-hidden="true">→</span>
          </a>
        </div>
      </Shell>
    );
  }

  const purchase = await getPurchaseByOrderNo(number).catch(() => null);
  // One rule, checked in one place, so the page and the route cannot disagree.
  const allowed = reviewableReason(purchase, user.id);

  if (!allowed.ok) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">{allowed.status === 409 ? "NOT YET" : "NO"}</p>
          <h1>
            {allowed.status === 404 ? "그런 주문번호가 없습니다"
              : allowed.status === 403 ? "본인 구매가 아닙니다"
              : allowed.status === 409 ? "아직 받지 않으셨습니다"
              : "지금은 판매하지 않습니다"}
          </h1>
          <p>{allowed.error}</p>
          <Link className="btn btn-line" href="/me">내 주문 보기</Link>
        </div>
      </Shell>
    );
  }

  const existing = await getReviewForPurchase(number).catch(() => null);

  return (
    <Shell>
      <div className="action-card">
        <p className="eyebrow">{purchase!.itemName}</p>
        <h1>{existing ? "후기 고치기" : "써보니 어떠셨나요"}</h1>
        <p>주문 <b>{number}</b> · {purchase!.planLabel} · {won(purchase!.price)}</p>
        <StoreReviewForm
          orderNo={number}
          itemId={purchase!.itemId}
          buyerName={user.name}
          initialRating={existing?.rating ?? 0}
          initialBody={existing?.body ?? ""}
          hasExisting={Boolean(existing)}
        />
      </div>
    </Shell>
  );
}
