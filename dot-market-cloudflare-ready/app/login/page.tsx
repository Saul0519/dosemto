import Link from "next/link";
import { discordConfig, safeNextPath } from "../../db/discord-session";
import { getUser } from "../session";
import { SITE } from "../site-content";
import LoginForm from "./form";

export const dynamic = "force-dynamic";

export const metadata = { title: "로그인" };

const REASONS: Record<string, string> = {
  denied: "로그인을 취소하셨습니다.",
  state: "로그인 요청이 만료됐습니다. 다시 시도해 주세요.",
  exchange: "디스코드 인증 서버가 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.",
  badsecret: "DISCORD_CLIENT_SECRET이 없거나 틀렸습니다. Worker의 Variables and Secrets를 확인해 주세요.",
  badredirect: "리디렉션 주소가 디스코드 앱에 등록된 값과 다릅니다. OAuth2 → Redirects에 https://dosemto.store/api/discord/callback 을 추가해 주세요.",
  badcode: "인증 코드가 만료됐습니다. 다시 시도해 주세요.",
  profile: "계정 정보를 받아오지 못했습니다.",
  network: "인증 서버에 연결하지 못했습니다.",
  unconfigured: "디스코드 로그인이 아직 설정되지 않았습니다.",
};

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string; login?: string }>;
}) {
  const { next, login } = await searchParams;
  const target = safeNextPath(next ?? "/");
  const [user, { configured }] = await Promise.all([getUser(), discordConfig()]);

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
          {user ? (
            <>
              <h1>이미 로그인되어 있습니다</h1>
              <p>현재 <b>{user.name}</b> 계정으로 접속 중입니다.</p>
              <Link className="btn btn-line" href={target}>돌아가기</Link>
            </>
          ) : (
            <>
              <h1>디스코드로 로그인</h1>
              <p>
                주문 접수와 후기 작성에 필요합니다. 로그인하면 연락처를 따로 적지 않아도 되고,
                작업이 진행될 때마다 디스코드로 알림이 갑니다.
                미리보기는 로그인 없이 그대로 보실 수 있습니다.
              </p>
              {login && REASONS[login] && <p className="action-error">{REASONS[login]}</p>}
              {configured
                ? <LoginForm next={target}/>
                : <p className="action-error">디스코드 로그인이 아직 설정되지 않았습니다. 사이트 관리자에게 알려주세요.</p>}
              <p className="action-note">
                이 사이트는 비밀번호를 받지 않습니다. 디스코드에서 받아오는 정보는
                계정 이름과 사용자 ID뿐이며, 서버 목록이나 메시지는 읽지 않습니다.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
