import Link from "next/link";
import { getChatGPTUser, platformSignOutPath } from "../chatgpt-auth";
import { isSuperAdmin, listManagedShops } from "../../db/shops";
import { listManagedOrders } from "../../db/orders";
import AdminPanel from "./panel";

export const dynamic = "force-dynamic";

// Identity arrives as a request header injected by whatever sits in front of the
// Worker. On this deployment that is Cloudflare Access. Redirecting to the
// ChatGPT sign-in path would land on a 404 here, so explain the situation
// instead of bouncing the visitor into a dead route.
const ACCESS_PATHS = [
  "dosemto.store/admin*",
  "dosemto.store/control*",
  "dosemto.store/api/admin/*",
  "dosemto.store/api/control/*",
];

export default async function AdminPage() {
  const user = await getChatGPTUser();

  if (!user) {
    return (
      <main className="admin-page">
        <header>
          <Link href="/">← 사이트로</Link>
          <strong>DOT MARKET</strong>
          <span>ADMIN</span>
        </header>
        <div className="admin-wrap">
          <div className="admin-intro">
            <p>SIGN IN REQUIRED</p>
            <h1>관리자 인증이 아직 연결되지 않았습니다</h1>
            <span>
              이 화면은 앞단에서 로그인을 처리하고 이메일을 헤더로 넘겨줄 때만 열립니다.
              지금은 그 헤더가 오지 않아 아무도 들어올 수 없는 상태입니다.
            </span>
          </div>
          <div className="admin-login">
            <h2>Cloudflare Access 설정하기</h2>
            <p>
              Zero Trust → Access → Applications에서 Self-hosted 애플리케이션을 만들고
              아래 경로를 보호한 뒤, Allow 정책에 관리자 이메일만 넣으세요.
            </p>
            <ul className="notice-list">
              {ACCESS_PATHS.map((path) => <li key={path}><code>{path}</code></li>)}
            </ul>
            <p className="field-help">
              설정이 끝나면 이 주소로 다시 들어왔을 때 Access 로그인 화면이 먼저 뜨고,
              통과한 이메일이 그대로 샵 관리자 계정이 됩니다.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const shops = await listManagedShops(user.email);
  const [orders, superAdmin, signOutPath] = await Promise.all([
    listManagedOrders(user.email),
    isSuperAdmin(user.email),
    platformSignOutPath("/"),
  ]);

  return (
    <AdminPanel
      userName={user.displayName}
      shops={shops}
      orders={orders}
      isSuperAdmin={superAdmin}
      signOutPath={signOutPath}
    />
  );
}
