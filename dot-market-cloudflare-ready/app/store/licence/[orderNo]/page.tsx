import Link from "next/link";
import { getUser } from "../../../session";
import { getItem, getPurchaseByOrderNo } from "../../../../db/store";
import { renderMarkdown } from "../../../../db/markdown";
import { won } from "../../../../db/store-plans";
import { SITE } from "../../../site-content";

export const dynamic = "force-dynamic";

export const metadata = { title: "이용 안내", robots: { index: false, follow: false } };

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="action-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>
          <span>{SITE.name}</span>
        </Link>
      </header>
      <div className={`action-shell${wide ? " action-shell-wide" : ""}`}>{children}</div>
    </main>
  );
}

export default async function LicencePage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const number = decodeURIComponent(orderNo).trim().toUpperCase();
  const user = await getUser().catch(() => null);

  if (!user) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">SIGN IN</p>
          <h1>디스코드로 로그인</h1>
          <p>주문 <b>{number}</b>의 이용 안내는 그 상품을 구매한 계정만 볼 수 있습니다.</p>
          <a className="btn btn-solid" href={`/login?next=${encodeURIComponent(`/store/licence/${number}`)}`}>
            디스코드로 로그인 <span className="arrow" aria-hidden="true">→</span>
          </a>
        </div>
      </Shell>
    );
  }

  const purchase = await getPurchaseByOrderNo(number).catch(() => null);
  // Knowing an order number is not enough; it has to be yours.
  if (!purchase || purchase.buyerId !== user.id) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">NO</p>
          <h1>{purchase ? "본인 구매가 아닙니다" : "그런 주문번호가 없습니다"}</h1>
          <p>이용 안내는 그 상품을 직접 구매하신 분만 볼 수 있습니다.</p>
          <Link className="btn btn-line" href="/me">내 주문 보기</Link>
        </div>
      </Shell>
    );
  }

  // The page below states that a licence was issued for this order. For a
  // refused request that is simply untrue, so it must not be shown.
  if (purchase.rejected) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">CLOSED</p>
          <h1>거절된 요청입니다</h1>
          <p>주문 {number}는 거절되어 이용 권한이 발급되지 않았습니다. 다시 신청하실 수 있습니다.</p>
          <Link className="btn btn-line" href="/store">상점 보기</Link>
        </div>
      </Shell>
    );
  }

  // Read straight from the product rather than the purchase, so an amended
  // notice reaches everyone who already holds a copy.
  const item = purchase.itemId ? await getItem(purchase.itemId).catch(() => null) : null;
  const body = item?.licence?.trim() ?? "";

  return (
    <Shell wide>
      <article className="deed">
        <div className="deed-band">
          <p className="deed-kind">이용 안내 · TERMS OF USE</p>
          <h1>{purchase.itemName}</h1>
        </div>

        <dl className="deed-meta">
          <div><dt>주문번호</dt><dd><code>{number}</code></dd></div>
          <div><dt>발급 대상</dt><dd>{purchase.buyerName}</dd></div>
          <div><dt>디스코드</dt><dd><code>{purchase.buyerId}</code></dd></div>
          <div><dt>도스 닉네임</dt><dd>{purchase.mcNick}</dd></div>
          <div><dt>기간 · 금액</dt><dd>{purchase.planLabel} · {won(purchase.price)}</dd></div>
          <div><dt>요청일</dt><dd>{purchase.createdAt.slice(0, 10)}</dd></div>
        </dl>

        {body
          ? <div className="deed-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}/>
          : <p className="deed-empty">이 상품에는 아직 등록된 이용 안내가 없습니다.</p>}

        <p className="deed-seal">
          이 문서는 <b>{purchase.buyerName}</b> 님의 주문 <code>{number}</code>에 대해 발급되었습니다.
          발급 기록은 서버에 남습니다.
        </p>

        <div className="deed-foot">
          <Link className="btn btn-line" href="/me">내 주문으로</Link>
          <span>{SITE.name} · {SITE.domain}</span>
        </div>
      </article>
    </Shell>
  );
}
