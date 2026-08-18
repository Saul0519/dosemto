import { getChatGPTUser } from "../../../../chatgpt-auth";
import { isSuperAdmin } from "../../../../../db/shops";
import { buildXlsx, Cell } from "../../../../../db/xlsx";

export const dynamic = "force-dynamic";

/** Far past any real ledger, and short of anything that would stall the worker. */
const MAX_ROWS = 20_000;

const COLUMNS = [
  { header: "날짜", width: 12 },
  { header: "구분", width: 9 },
  { header: "샵 · 상품", width: 22 },
  { header: "손님", width: 18 },
  { header: "주문번호", width: 23 },
  { header: "상태", width: 12 },
  { header: "금액", width: 13 },
  { header: "매출 반영", width: 11 },
];

type Sent = {
  at?: unknown; kind?: unknown; source?: unknown; customer?: unknown;
  orderNo?: unknown; status?: unknown; price?: unknown; counted?: unknown;
};

const text = (value: unknown, limit = 200) => String(value ?? "").slice(0, limit);

/**
 * A whole number a spreadsheet will accept.
 *
 * Past about 1e21 JavaScript writes a number in exponent form, and a cell like
 * `1e+21` makes the whole workbook unopenable rather than one figure wrong.
 */
const money = (value: unknown) => {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.max(-1e15, Math.min(1e15, number)) : 0;
};

/**
 * Builds the spreadsheet from the rows the screen is showing.
 *
 * The rows come from the browser rather than being read again here, and that is
 * deliberate: the point of the button is "give me this, as a file". Filtered,
 * grouped and sorted the way it is on screen. Rebuilding that server-side would
 * mean writing the same grouping twice and having the file quietly disagree
 * with the table the moment the two drifted.
 *
 * Nothing is stored and nothing is trusted — the file is handed straight back
 * to the person who asked, and every cell goes through the same escaping.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !(await isSuperAdmin(user.email))) {
    return Response.json({ error: "총괄 관리자만 내려받을 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { title?: unknown; rows?: unknown } | null;
  const sent = Array.isArray(body?.rows) ? (body.rows as Sent[]).slice(0, MAX_ROWS) : [];

  const rows: Cell[][] = sent.map((row) => (row && typeof row === "object" ? row : {})).map((row) => [
    text(row.at).slice(0, 10),
    row.kind === "store" ? "상점" : "그림샵",
    text(row.source, 80),
    text(row.customer, 40),
    text(row.orderNo, 40),
    text(row.status, 20),
    money(row.price),
    row.counted === true ? "예" : "아니오",
  ]);

  // A total under the rows, because that is the number the whole thing is for.
  const total = money(sent.reduce(
    (sum, row) => sum + (row && row.counted === true ? money(row.price) : 0),
    0,
  ));
  rows.push([]);
  rows.push(["합계", "", "", "", "", "매출", total, ""]);

  const file = buildXlsx({
    sheetName: text(body?.title, 31) || "매출 장부",
    columns: COLUMNS,
    rows,
  });

  // The name carries the date so a folder of these stays sorted by itself.
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `dot-market-ledger-${stamp}.xlsx`;

  return new Response(file, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // The plain name is for readers that ignore the encoded one; the encoded
      // one is what carries anything outside ASCII.
      "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "private, no-store",
    },
  });
}
