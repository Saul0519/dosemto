import Link from "next/link";
import { getUser } from "../session";
import { SITE } from "../site-content";
import ApplyForm from "./form";

export const dynamic = "force-dynamic";

export const metadata = { title: "입점 신청", robots: { index: false, follow: false } };

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

export default async function ApplyPage() {
  const user = await getUser().catch(() => null);

  if (!user) {
    return (
      <Shell>
        <p className="eyebrow">JOIN THE MARKET</p>
        <h1>입점 신청</h1>
        <p className="action-lede">
          디스코드로 로그인한 뒤 신청할 수 있습니다. 운영자가 답을 보낼 곳이 있어야 하고,
          아무나 대신 신청하는 일도 막을 수 있습니다.
        </p>
        <Link className="btn btn-solid" href={`/login?next=${encodeURIComponent("/apply")}`}>
          디스코드로 로그인 <span aria-hidden="true">→</span>
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="eyebrow">JOIN THE MARKET</p>
      <h1>입점 신청</h1>
      <p className="action-lede">
        마켓에 내 공방을 올리고 싶다면 아래를 적어 보내주세요. 사이트 운영자가 읽고
        디스코드로 답을 드립니다.
      </p>
      <ApplyForm applicantName={user.name} applicantId={user.id}/>
    </Shell>
  );
}
