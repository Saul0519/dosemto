import { getChatGPTUser } from "../../../../chatgpt-auth";
import { fetchLicences, forgetLicenceCache, getLicenceServer, setLicenceServer } from "../../../../../db/licence-server";
import { isSuperAdmin } from "../../../../../db/shops";

export const dynamic = "force-dynamic";

async function denied() {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 할 수 있습니다." }, { status: 403 });
  }
  return null;
}

/** Where the licence list is read from. Blank switches the lookup off. */
export async function PUT(request: Request) {
  const blocked = await denied();
  if (blocked) return blocked;

  const body = await request.json().catch(() => null) as { url?: string; token?: string } | null;
  const url = String(body?.url ?? "").trim();
  if (url) {
    try {
      const parsed = new URL(url);
      // The token rides on this request, so it has to be encrypted in transit.
      // Loopback is the exception: it never leaves the machine, and without it
      // the whole thing could not be exercised locally.
      const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
        return Response.json({ error: "주소는 https:// 로 시작해야 합니다." }, { status: 400 });
      }
    } catch {
      return Response.json({ error: "주소를 알아보지 못했습니다." }, { status: 400 });
    }
  }

  // An absent token leaves the stored one alone, so editing the address does
  // not quietly wipe the secret.
  await setLicenceServer(url, typeof body?.token === "string" ? body.token : null);
  return Response.json({ ok: true, ...(await getLicenceServer()) });
}

/** Reads the list right now, so the owner can see whether it actually works. */
export async function POST() {
  const blocked = await denied();
  if (blocked) return blocked;

  forgetLicenceCache();
  const { rows, stale, configured } = await fetchLicences();
  if (!configured) return Response.json({ error: "먼저 주소를 저장해 주세요." }, { status: 400 });
  if (stale) {
    return Response.json({
      error: "라이선스 서버에서 목록을 읽지 못했습니다. 주소와 토큰을 확인해 주세요.",
    }, { status: 502 });
  }
  // Grouped by state so the owner can see at a glance that expiry is understood.
  const byState: Record<string, number> = {};
  for (const row of rows) byState[row.state] = (byState[row.state] ?? 0) + 1;
  return Response.json({
    ok: true,
    count: rows.length,
    byState,
    sample: rows.slice(0, 5).map((row) => row.code),
  });
}
