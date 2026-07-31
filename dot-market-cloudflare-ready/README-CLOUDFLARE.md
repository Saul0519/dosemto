# DOT MARKET — Cloudflare 배포 안내

이 프로젝트는 정적 HTML 하나가 아니라 Cloudflare Workers, D1, R2를 함께
사용하는 풀스택 사이트입니다. `dist` 폴더나 ZIP을 Pages의 정적 업로드 칸에
넣지 말고, 아래 순서로 GitHub 저장소를 Workers에 연결하세요.

## 1. 저장소 준비

1. 이 ZIP의 내용 전체를 GitHub 저장소 루트에 올립니다.
2. `wrangler.jsonc`에서 `SUPER_ADMIN_EMAIL`을 본인이 Cloudflare Access에
   사용할 실제 이메일로 바꿉니다.
3. 비밀키는 GitHub에 커밋하지 않습니다.

## 2. D1과 R2 만들기

Cloudflare 대시보드에서 다음 리소스를 만듭니다.

- D1 데이터베이스 이름: `dot-market-db`
- R2 버킷 이름: `dot-market-files`

D1을 만든 뒤 표시되는 Database ID를 복사해 `wrangler.jsonc`의
`00000000-0000-4000-8000-000000000000` 자리에 넣고 GitHub에 커밋합니다.

## 3. Workers에 GitHub 연결

1. Cloudflare 대시보드 → **Workers & Pages** → **Create application**
2. **Import a repository**에서 GitHub 저장소를 선택
3. Production branch는 `main`
4. Deploy command는 `npm run deploy:cloudflare`
5. Root directory는 저장소 루트(`/`)

첫 배포 전에 Workers 설정의 Variables and Secrets에 다음 값을 넣습니다.

| 이름 | 형식 | 값 |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Secret | Turnstile 비밀키 |
| `WEBHOOK_ENCRYPTION_KEY` | Secret | `openssl rand -hex 32`로 새로 만든 값 |
| `TURNSTILE_SITE_KEY` | Variable | `wrangler.jsonc`에 이미 포함된 공개 사이트키 |
| `SUPER_ADMIN_EMAIL` | Variable | 본인의 실제 관리자 로그인 이메일 |

채팅이나 GitHub에 노출된 Turnstile 비밀키는 운영 전에 Cloudflare에서
재발급하고 새 값을 Secret으로 저장하세요.

## 4. D1 테이블 생성

`npm run deploy:cloudflare`가 배포 전에 아직 적용되지 않은 D1 마이그레이션을
자동으로 적용합니다. Cloudflare의 GitHub 빌드 환경에서는 확인 질문 없이
진행되고, 각 마이그레이션 전 백업이 생성됩니다.

로컬에서 먼저 적용하고 싶다면 Cloudflare에 로그인한 뒤 실행합니다.

```bash
npx wrangler login
npm run db:migrate:cloudflare
```

또는 Cloudflare의 터미널/CI에서 다음 명령을 실행해도 됩니다.

```bash
npx wrangler d1 migrations apply dot-market-db --remote
```

## 5. 관리자 경로 보호

Cloudflare Zero Trust → Access → Applications에서 Self-hosted application을
만들고 다음 경로를 보호합니다.

- `dosemto.store/admin*`
- `dosemto.store/control*`
- `dosemto.store/api/admin/*`
- `dosemto.store/api/control/*`

Allow 정책에는 총괄 관리자와 각 샵 관리자 이메일만 넣습니다. Access가
인증 후 주입하는 이메일을 사이트가 관리자 계정으로 사용합니다. 보호 경로를
설정하지 않은 상태로 관리자 기능을 공개 운영하지 마세요.

## 6. 도메인 연결

첫 Workers 배포가 성공한 뒤 해당 Worker의
**Settings → Domains & Routes → Add → Custom Domain**에서
`dosemto.store`를 추가합니다. `www.dosemto.store`도 쓸 경우 따로 추가합니다.
기존 GitHub Pages용 `www → saul0519.github.io` CNAME은 먼저 삭제해야 합니다.
Cloudflare가 Worker용 DNS 레코드와 인증서를 자동으로 만듭니다.

## 로컬 확인

`.env.example`을 참고해 `.env.local`을 만들고 다음을 실행합니다.

```bash
npm ci
npm run dev
```

운영 비밀키 파일과 `.env*`는 절대 GitHub에 올리지 마세요.
