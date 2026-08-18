"use client";

import { useEffect, useMemo, useState } from "react";
import { readResult } from "../read-result";
import McHead from "../mc-head";
import {
  COUNTS_AS_REVENUE, LedgerKind, LedgerRow, SETTABLE, statusEndpoint, statusLabel,
} from "../../db/ledger-labels";

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

/**
 * How the rows are piled up.
 *
 * Not a fixed report. Which cut answers today's question changes — one day it
 * is which shop is busiest, the next it is who keeps coming back — so the
 * grouping is a control rather than a decision made here.
 */
const GROUPS = [
  { id: "none", label: "묶지 않기" },
  { id: "source", label: "샵 · 상품별" },
  { id: "kind", label: "그림샵 / 상점" },
  { id: "customer", label: "손님별" },
  { id: "status", label: "상태별" },
  { id: "month", label: "월별" },
] as const;

type GroupId = typeof GROUPS[number]["id"];

const RANGES = [
  { id: "all", label: "전체", days: 0 },
  { id: "30", label: "30일", days: 30 },
  { id: "90", label: "90일", days: 90 },
  { id: "365", label: "1년", days: 365 },
] as const;

type RangeId = typeof RANGES[number]["id"];

export default function LedgerPanel({ say, busy, setBusy }: {
  say: (text: string, kind?: "success" | "error") => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  /** When the rows were read. The date filters measure back from this. */
  const [readAt, setReadAt] = useState("");
  const [group, setGroup] = useState<GroupId>("none");
  const [range, setRange] = useState<RangeId>("all");
  const [kind, setKind] = useState<"all" | LedgerKind>("all");
  const [onlyCounted, setOnlyCounted] = useState(false);
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Loaded on mount rather than passed in from the page: the ledger is the one
  // part here that is worth re-reading without a refresh, since Discord changes
  // it from outside while this screen is open.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/control/ledger");
        const result = await readResult<{ rows: LedgerRow[] }>(response, "장부를 읽지 못했습니다.");
        if (alive) { setRows(result.rows); setReadAt(new Date().toISOString()); }
      } catch {
        if (alive) setRows([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  const reload = () => void (async () => {
    try {
      const response = await fetch("/api/control/ledger");
      const result = await readResult<{ rows: LedgerRow[] }>(response, "장부를 읽지 못했습니다.");
      setRows(result.rows);
      setReadAt(new Date().toISOString());
      say("장부를 다시 읽었습니다.");
    } catch (error) {
      say(error instanceof Error ? error.message : "장부를 읽지 못했습니다.", "error");
    }
  })();

  const shown = useMemo(() => {
    if (!rows) return [];
    const needle = find.trim().toLowerCase();
    const days = RANGES.find((entry) => entry.id === range)?.days ?? 0;
    // Days, not instants, and compared as YYYY-MM-DD. The rows carry SQLite's
    // "2026-07-19 12:00:00"; an ISO string is "2026-07-19T12:00:00.000Z". Those
    // two diverge at the eleventh character, where a space sorts below a T — so
    // comparing them whole would drop the whole boundary day.
    //
    // Measured from when the rows were read rather than from now, because
    // reading the clock during a render would filter the same rows differently
    // on a redraw that changed nothing.
    const floor = days && readAt
      ? new Date(new Date(readAt).getTime() - days * 86_400_000).toISOString().slice(0, 10)
      : "";

    return rows.filter((row) => {
      if (kind !== "all" && row.kind !== kind) return false;
      if (onlyCounted && !row.counted) return false;
      if (floor && row.at.slice(0, 10) < floor) return false;
      if (!needle) return true;
      return [row.source, row.customer, row.orderNo, statusLabel(row.kind, row.status)]
        .some((field) => field.toLowerCase().includes(needle));
    });
  }, [rows, kind, onlyCounted, range, find, readAt]);

  /** The heading a row belongs under, for the chosen cut. */
  const bucketOf = (row: LedgerRow) => {
    switch (group) {
      case "source": return row.source || "(이름 없음)";
      case "kind": return row.kind === "store" ? "상점" : "그림샵";
      case "customer": return row.customer || "(닉네임 없음)";
      case "status": return statusLabel(row.kind, row.status);
      case "month": return row.at.slice(0, 7);
      default: return "";
    }
  };

  const buckets = useMemo(() => {
    if (group === "none") return [{ name: "", rows: shown }];
    const map = new Map<string, LedgerRow[]>();
    for (const row of shown) {
      const name = bucketOf(row);
      const list = map.get(name);
      if (list) list.push(row); else map.set(name, [row]);
    }
    return [...map.entries()]
      .map(([name, list]) => ({ name, rows: list }))
      // Biggest takings first: the point of grouping is to see where it comes
      // from, and that answer should not be somewhere down the page.
      .sort((a, b) => total(b.rows) - total(a.rows));
    // bucketOf reads `group`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, group]);

  const revenue = total(shown);

  const change = (row: LedgerRow, status: string) => {
    setBusy(true); say("");
    void (async () => {
      try {
        const response = await fetch(statusEndpoint(row.kind, row.id), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        });
        await readResult(response, "상태를 바꾸지 못했습니다.");
        setRows((current) => (current ?? []).map((item) => item.key === row.key
          ? { ...item, status, counted: countsFor(item.kind, status) }
          : item));
        say(`${row.orderNo} → ${statusLabel(row.kind, status)}`);
      } catch (error) {
        say(error instanceof Error ? error.message : "상태를 바꾸지 못했습니다.", "error");
      } finally { setBusy(false); }
    })();
  };

  const download = () => {
    setBusy(true); say("");
    void (async () => {
      try {
        // Whatever is on screen, in the order it is on screen — including the
        // group headings, so the file reads the way the table does.
        const flat = buckets.flatMap((bucket) => bucket.rows.map((row) => ({
          at: row.at,
          kind: row.kind,
          source: bucket.name && group !== "source" ? `${bucket.name} · ${row.source}` : row.source,
          customer: row.customer,
          orderNo: row.orderNo,
          status: statusLabel(row.kind, row.status),
          price: row.price,
          counted: row.counted,
        })));

        const response = await fetch("/api/control/ledger/export", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "매출 장부", rows: flat }),
        });
        if (!response.ok) throw new Error("파일을 만들지 못했습니다.");

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameFrom(response) || "dot-market-ledger.xlsx";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        say(`${flat.length}줄을 엑셀로 내려받았습니다.`);
      } catch (error) {
        say(error instanceof Error ? error.message : "파일을 만들지 못했습니다.", "error");
      } finally { setBusy(false); }
    })();
  };

  return (
    <>
      <div className="control-list-head">
        <h2>매출 장부</h2>
        <span>
          {rows === null ? "읽는 중…" : `${shown.length}줄 · 매출 ${won(revenue)}`}
        </span>
      </div>

      <div className="ledger-controls">
        <label>기간
          <select value={range} onChange={(e) => setRange(e.target.value as RangeId)}>
            {RANGES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <label>구분
          <select value={kind} onChange={(e) => setKind(e.target.value as "all" | LedgerKind)}>
            <option value="all">전체</option>
            <option value="shop">그림샵</option>
            <option value="store">상점</option>
          </select>
        </label>
        <label>묶기
          <select value={group} onChange={(e) => setGroup(e.target.value as GroupId)}>
            {GROUPS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <label className="ledger-find">찾기
          <input value={find} placeholder="닉네임 · 주문번호 · 샵"
            onChange={(e) => setFind(e.target.value)}/>
        </label>
        <label className="ledger-switch">
          <input type="checkbox" checked={onlyCounted}
            onChange={(e) => setOnlyCounted(e.target.checked)}/>
          <span>매출로 잡힌 것만</span>
        </label>
        <div className="ledger-actions">
          <button type="button" onClick={reload} disabled={busy}>새로 읽기</button>
          <button type="button" className="primary" onClick={download} disabled={busy || shown.length === 0}>
            엑셀로 내려받기
          </button>
        </div>
      </div>

      <p className="field-help">
        상태 칸을 눌러 바로 바꿀 수 있습니다. 디스코드에서 수락·거절·완성을 누른 것도 여기에 그대로 들어옵니다.
        상점 요청을 여기서 거절하면 손님에게 알림이 갑니다.
      </p>

      {rows !== null && shown.length === 0 ? (
        <p className="field-help">조건에 맞는 줄이 없습니다.</p>
      ) : (
        <div className="ledger-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>날짜</th><th>구분</th><th>샵 · 상품</th><th>손님</th>
                <th>주문번호</th><th>상태</th><th className="num">금액</th>
              </tr>
            </thead>
            {buckets.map((bucket) => {
              const shut = bucket.name !== "" && open[bucket.name] === false;
              return (
                <tbody key={bucket.name || "all"}>
                  {bucket.name !== "" && (
                    <tr className="ledger-group">
                      <th colSpan={6}>
                        <button type="button"
                          onClick={() => setOpen((current) => ({ ...current, [bucket.name]: shut }))}>
                          <span aria-hidden="true">{shut ? "▸" : "▾"}</span>
                          {bucket.name}
                          <i>{bucket.rows.length}건</i>
                        </button>
                      </th>
                      <th className="num">{won(total(bucket.rows))}</th>
                    </tr>
                  )}
                  {!shut && bucket.rows.map((row) => (
                    <tr key={row.key} className={row.counted ? "" : "faint"}>
                      <td>{row.at.slice(0, 10)}</td>
                      <td><span className={`ledger-kind ${row.kind}`}>{row.kind === "store" ? "상점" : "그림샵"}</span></td>
                      <td>{row.source}</td>
                      <td>
                        {!row.customer ? <span className="ledger-nobody">—</span>
                          : row.customerIsNick
                            ? <span className="mc-name"><McHead nick={row.customer} size={18}/><span>{row.customer}</span></span>
                            : <span className="ledger-discord">{row.customer}</span>}
                      </td>
                      <td><code>{row.orderNo}</code></td>
                      <td>
                        <select className={`ledger-status is-${row.status}`} value={row.status} disabled={busy}
                          onChange={(e) => change(row, e.target.value)}>
                          {/* A status nobody may set still has to show, or the
                              row would appear to be something it is not. */}
                          {!SETTABLE[row.kind].includes(row.status) && (
                            <option value={row.status}>{statusLabel(row.kind, row.status)}</option>
                          )}
                          {SETTABLE[row.kind].map((value) => (
                            <option key={value} value={value}>{statusLabel(row.kind, value)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="num">{won(row.price)}</td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
            <tfoot>
              <tr>
                <th colSpan={6}>합계 · 매출로 잡힌 것만</th>
                <th className="num">{won(revenue)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function total(rows: LedgerRow[]) {
  return rows.reduce((sum, row) => sum + (row.counted ? row.price : 0), 0);
}

function countsFor(kind: LedgerKind, status: string) {
  return status === COUNTS_AS_REVENUE[kind];
}

/** Pulls the server's chosen filename back out of the header it sent it in. */
function fileNameFrom(response: Response) {
  const header = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) { try { return decodeURIComponent(encoded[1]); } catch { /* fall through */ } }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? "";
}
