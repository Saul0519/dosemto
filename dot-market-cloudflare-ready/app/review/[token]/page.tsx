import Link from "next/link";
import { lookupReviewToken } from "../../../db/reviews";
import { SITE } from "../../site-content";
import ReviewForm from "./form";

export const dynamic = "force-dynamic";

export const metadata = { title: "후기 남기기", robots: { index: false, follow: false } };

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

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await lookupReviewToken(token).catch(() => null);

  if (!invite) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">LINK NOT FOUND</p>
          <h1>쓸 수 없는 링크입니다</h1>
          <p>주소가 잘못됐거나 주문이 삭제됐습니다.</p>
          <Link className="btn btn-line" href="/">사이트 둘러보기</Link>
        </div>
      </Shell>
    );
  }

  if (!invite.unlockedAt) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">NOT YET</p>
          <h1>아직 작업이 끝나지 않았습니다</h1>
          <p>
            샵에서 마감 처리를 하면 이 링크로 후기를 남길 수 있습니다.
            그때까지 이 주소를 보관해 주세요.
          </p>
          <Link className="btn btn-line" href={`/shop/${invite.shopSlug}/about`}>{invite.shopName} 보기</Link>
        </div>
      </Shell>
    );
  }

  if (invite.usedAt) {
    return (
      <Shell>
        <div className="action-card">
          <p className="eyebrow">ALREADY SENT</p>
          <h1>후기를 이미 남기셨습니다</h1>
          <p>주문 한 건당 한 번만 남길 수 있습니다. 남겨주셔서 고맙습니다.</p>
          <Link className="btn btn-line" href={`/shop/${invite.shopSlug}/about`}>{invite.shopName} 후기 보기</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="action-card">
        <p className="eyebrow">{invite.shopName}</p>
        <h1>작업은 어떠셨나요</h1>
        <p>
          주문 <b>{invite.orderId}</b> · 캔버스 {invite.tileCount}장 · 마감 {invite.deadline}일.
          남긴 후기는 이 샵 소개 페이지에 공개됩니다.
        </p>
        <ReviewForm token={token} shopSlug={invite.shopSlug}/>
      </div>
    </Shell>
  );
}
