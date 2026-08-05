import Link from "next/link";
import { deadlineLabel } from "../../db/deadlines";
import { getUser } from "../session";
import { listOrdersForUser } from "../../db/orders";
import { getReviewForOrder } from "../../db/reviews";
import { SITE } from "../site-content";
import AccountChip from "../account-chip";

export const dynamic = "force-dynamic";

export const metadata = { title: "내 주문", robots: { index: false, follow: false } };

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

const STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "접수됨", tone: "new" },
  working: { label: "작업 중", tone: "working" },
  completed: { label: "완료", tone: "completed" },
  cancelled: { label: "거절됨", tone: "cancelled" },
  notification_failed: { label: "알림 실패", tone: "cancelled" },
};

export default async function MyOrdersPage() {
  const user = await getUser().catch(() => null);

  if (!user) {
    return (
      <main className="action-page">
        <header className="topbar">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>
            <span>{SITE.name}</span>
          </Link>
        </header>
        <div className="action-shell">
          <div className="action-card">
            <p className="eyebrow">SIGN IN</p>
            <h1>내 주문을 보려면 로그인하세요</h1>
            <p>주문할 때 쓰신 디스코드 계정으로 로그인하시면 접수 내역이 모두 보입니다.</p>
            <a className="btn btn-solid" href="/login?next=%2Fme">
              디스코드로 로그인 <span className="arrow" aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </main>
    );
  }

  const orders = await listOrdersForUser(user.id).catch(() => []);
  const reviews = await Promise.all(
    orders.map(async (order) => [order.id, await getReviewForOrder(order.id).catch(() => null)] as const),
  );
  const reviewed = new Map(reviews);

  const spent = orders
    .filter((order) => order.status === "completed")
    .reduce((sum, order) => sum + order.totalPrice, 0);

  return (
    <div className="market-page">
      <header className="market-header">
        <div className="wrap">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>
            <span>{SITE.name}</span>
          </Link>
          <AccountChip userName={user.name} next="/me"/>
        </div>
      </header>

      <main className="market-section" style={{ borderTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">MY ORDERS</p>
            <h2>{user.name}님의 주문</h2>
            <p>
              주문 {orders.length}건 · 완료 {orders.filter((o) => o.status === "completed").length}건
              {spent > 0 && ` · 완료된 주문 합계 ${won(spent)}`}
            </p>
          </div>

          {orders.length === 0 ? (
            <div className="empty-shops">
              <b>아직 주문이 없습니다.</b>
              <span>샵에 그림을 맡기시면 여기에 기록이 남습니다.</span>
              <Link className="btn btn-line" href="/#shops">샵 둘러보기</Link>
            </div>
          ) : (
            <ul className="my-orders">
              {orders.map((order) => {
                const status = STATUS[order.status] ?? { label: order.status, tone: "new" };
                const review = reviewed.get(order.id) ?? null;
                return (
                  <li key={order.id}>
                    <div className="my-order-art lattice">
                      {/* Only this customer can fetch it; the route checks the session. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/my/orders/${order.id}/preview`} alt={`${order.id} 미리보기`} loading="lazy"/>
                    </div>
                    <div className="my-order-body">
                      <div className="my-order-head">
                        <code>{order.id}</code>
                        <span className={`order-tag ${status.tone}`}>{status.label}</span>
                        <time dateTime={order.createdAt}>{order.createdAt.slice(0, 10)}</time>
                      </div>
                      <h3><Link href={`/shop/${order.shopSlug}/about`}>{order.shopName}</Link></h3>
                      <dl>
                        <div><dt>규격</dt><dd>{order.gridX} × {order.gridY} · {order.tileCount}장</dd></div>
                        <div><dt>마감</dt><dd>{deadlineLabel(order.deadline)}</dd></div>
                        <div><dt>금액</dt><dd>{won(order.totalPrice)}</dd></div>
                        <div><dt>원본</dt><dd>{order.originalFilename}</dd></div>
                      </dl>
                      <div className="my-order-actions">
                                                {order.status === "completed" && (
                          <Link href={`/review/${order.id}`}>
                            {review ? `후기 수정 (★ ${review.rating})` : "후기 남기기"}
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      <footer className="market-footer">
        <div className="wrap">
          <div>
            <Link className="brand" href="/">
              <span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>
              <span>{SITE.name}</span>
            </Link>
            <p>{SITE.footer} · {SITE.domain}</p>
            <p className="site-disclaimer">{SITE.disclaimer}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
