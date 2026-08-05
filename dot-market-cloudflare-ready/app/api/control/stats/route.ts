import { getChatGPTUser } from "../../../chatgpt-auth";
import { Period, readStats } from "../../../../db/stats";
import { isSuperAdmin } from "../../../../db/shops";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 볼 수 있습니다." }, { status: 403 });
  }

  const asked = Number(new URL(request.url).searchParams.get("period"));
  const period: Period = asked === 30 ? 30 : asked === 0 ? 0 : 7;

  try {
    return Response.json({ ok: true, stats: await readStats(period) });
  } catch {
    return Response.json({ error: "숫자를 불러오지 못했습니다." }, { status: 503 });
  }
}
