import { getChatGPTUser } from "../../../chatgpt-auth";
import { isSuperAdmin } from "../../../../db/shops";
import { readLedger } from "../../../../db/ledger";

export const dynamic = "force-dynamic";

/**
 * The ledger rows.
 *
 * Read-only. Changing a row goes through whichever endpoint already owns that
 * kind of record — the order one, the purchase one — so there is one place per
 * half that decides what a status change means, rather than two that have to be
 * kept in step.
 */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 볼 수 있습니다." }, { status: 403 });
  }
  // Every shop's takings in one answer. Nothing should keep a copy of it.
  return Response.json({ ok: true, rows: await readLedger() }, {
    headers: { "cache-control": "private, no-store" },
  });
}
