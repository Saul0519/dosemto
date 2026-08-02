import Link from "next/link";
import { mcAuthConfig, safeNextPath } from "../../db/mc-session";
import { getPlayer } from "../session";
import { SITE } from "../site-content";
import LoginForm from "./form";

export const dynamic = "force-dynamic";

export const metadata = { title: "로그인" };

const REASONS: Record<string, string> = {
  denied: "로그인을 취소하셨습니다.",
  state: "로그인 요청이 만료됐습니다. 다시 시도해 주세요.",
  exchange: "마인크래프트 인증 서버가 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.",
  profile: "계정 정보를 받아오지 못했습니다.",
  network: "인증 서버에 연결하지 못했습니다.",
  unconfigured: "마인크래프트 로그인이 아직 설정되지 않았습니다.",
};

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string; mc?: string }>;
}) {
  const { next, mc } = await searchParams;
  const target = safeNextPath(next ?? "/");
  const [player, { configured }] = await Promise.all([getPlayer(), mcAuthConfig()]);

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
          {player ? (
            <>
              <h1>이미 로그인되어 있습니다</h1>
              <p>현재 <b>{player.name}</b> 계정으로 접속 중입니다.</p>
              <Link className="btn btn-line" href={target}>돌아가기</Link>
            </>
          ) : (
            <>
              <h1>마인크래프트 계정으로 로그인</h1>
              <p>
                주문 접수와 후기 작성에 필요합니다. 가짜 주문을 막기 위해 정품 계정만 받습니다.
                도안 변환과 PNG 다운로드는 로그인 없이 그대로 쓰실 수 있습니다.
              </p>
              {mc && REASONS[mc] && <p className="action-error">{REASONS[mc]}</p>}
              {configured
                ? <LoginForm next={target}/>
                : <p className="action-error">마인크래프트 로그인이 아직 설정되지 않았습니다. 사이트 관리자에게 알려주세요.</p>}
              <p className="action-note">
                로그인은 Mc-Auth를 통해 처리됩니다. 이 사이트는 비밀번호를 받지 않고,
                받아오는 정보는 계정 이름과 UUID뿐입니다.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
