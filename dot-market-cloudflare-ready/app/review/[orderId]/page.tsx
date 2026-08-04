import Link from "next/link";
import { getUser } from "../../session";
import { getOrderForReview, getReviewForOrder } from "../../../db/reviews";
import { SITE } from "../../site-content";
import ReviewForm from "./form";

export const dynamic = "force-dynamic";

export const metadata = { title: "후기", robots: { index: false, follow: false } };

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

export default async function ReviewPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await getUser().catch(() => null);

  if (!user) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">SIGN IN</p>
          <h1>디스코드로 로그인</h1>
          <p>
            주문 <b>{orderId}</b>의 후기를 남기려면 그 주문을 넣으신 계정으로 로그인해 주세요.
            후기에는 로그인한 계정 이름이 표시됩니다.
          </p>
          <a className="btn btn-solid" href={`/login?next=${encodeURIComponent(`/review/${orderId}`)}`}>
            디스코드로 로그인 <span className="arrow" aria-hidden="true">→</span>
          </a>
        </div>
      </Shell>
    );
  }

  const order = await getOrderForReview(orderId).catch(() => null);

  if (!order) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">NOT FOUND</p>
          <h1>그런 주문번호가 없습니다</h1>
          <p>번호를 다시 확인해 주세요. 내 주문 목록에서 정확한 번호를 볼 수 있습니다.</p>
          <Link className="btn btn-line" href="/me">내 주문 보기</Link>
        </div>
      </Shell>
    );
  }

  // Knowing an order number is not enough; it has to be your order.
  if (order.ownerId !== user.id) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">NOT YOURS</p>
          <h1>본인 주문이 아닙니다</h1>
          <p>후기는 그 주문을 직접 넣으신 분만 남길 수 있습니다.</p>
          <Link className="btn btn-line" href="/me">내 주문 보기</Link>
        </div>
      </Shell>
    );
  }

  if (order.status !== "completed") {
    const stage = order.status === "cancelled" ? "거절된" : "진행 중인";
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">NOT YET</p>
          <h1>아직 작업이 끝나지 않았습니다</h1>
          <p>
            주문 <b>{orderId}</b>은(는) 지금 {stage} 상태입니다.
            샵이 마감 처리를 하면 후기를 남길 수 있습니다.
          </p>
          <Link className="btn btn-line" href="/me">내 주문 보기</Link>
        </div>
      </Shell>
    );
  }

  const existing = await getReviewForOrder(orderId).catch(() => null);

  return (
    <Shell>
      <div className="action-card">
        <p className="eyebrow">{order.shopName}</p>
        <h1>{existing ? "후기 고치기" : "작업은 어떠셨나요"}</h1>
        <p>
          주문 <b>{orderId}</b> · {order.gridX} × {order.gridY} · 캔버스 {order.tileCount}장 ·{" "}
          {order.totalPrice.toLocaleString("ko-KR")}원
        </p>
        <ReviewForm
          orderId={orderId}
          shopSlug={order.shopSlug}
          playerName={user.name}
          initialRating={existing?.rating ?? 0}
          initialBody={existing?.body ?? ""}
          hasExisting={Boolean(existing)}
          initialPhotoUrl={existing?.imageUrl ?? null}
        />
      </div>
    </Shell>
  );
}
