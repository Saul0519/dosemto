import Link from "next/link";
import { deadlineLabel } from "../../../db/deadlines";
import { ACTION_LABELS, lookupAction } from "../../../db/order-actions";
import { SITE } from "../../site-content";
import ActionConfirm from "./confirm";

export const dynamic = "force-dynamic";

export const metadata = { title: "주문 처리", robots: { index: false, follow: false } };

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

const STATUS_LABELS: Record<string, string> = {
  new: "신규 접수",
  working: "작업 중",
  completed: "완료",
  cancelled: "취소",
  notification_failed: "알림 실패",
};

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

export default async function OrderActionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await lookupAction(token).catch(() => null);

  if (!found) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">LINK NOT FOUND</p>
          <h1>쓸 수 없는 링크입니다</h1>
          <p>주소가 잘못됐거나 해당 주문이 삭제됐습니다. 관리자 페이지의 주문 기록에서 직접 처리해 주세요.</p>
          <Link className="btn btn-line" href="/admin">샵 관리자로 가기</Link>
        </div>
      </Shell>
    );
  }

  if (found.usedAt) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">ALREADY USED</p>
          <h1>이미 처리된 링크입니다</h1>
          <p>
            주문 <b>{found.orderId}</b>은(는) 지금 <b>{STATUS_LABELS[found.status] ?? found.status}</b> 상태입니다.
            링크는 한 번만 쓸 수 있습니다. 상태를 다시 바꾸려면 관리자 페이지를 이용해 주세요.
          </p>
          <Link className="btn btn-line" href="/admin">샵 관리자로 가기</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="action-card">
        <p className="eyebrow">{found.shopName}</p>
        <h1>{ACTION_LABELS[found.action]}</h1>
        <dl className="action-facts">
          <div><dt>주문번호</dt><dd>{found.orderId}</dd></div>
          <div><dt>규격</dt><dd>{found.gridX} × {found.gridY} · {found.tileCount}장</dd></div>
          <div><dt>마감</dt><dd>{deadlineLabel(found.deadline)}</dd></div>
          <div><dt>금액</dt><dd>{won(found.totalPrice)}</dd></div>
          <div><dt>연락처</dt><dd>{found.contact}</dd></div>
          <div><dt>현재 상태</dt><dd>{STATUS_LABELS[found.status] ?? found.status}</dd></div>
        </dl>
        <ActionConfirm token={token} action={found.action} label={ACTION_LABELS[found.action]}/>
      </div>
    </Shell>
  );
}
