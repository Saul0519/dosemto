"use client";

import { useState } from "react";
import Link from "next/link";

type Result = { status: string; reviewUrl?: string | null };

// Discord and messaging apps fetch link previews, so the token must never be
// spent by loading the page. Only this explicit POST consumes it.
export default function ActionConfirm({ token, action, label }: {
  token: string;
  action: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/a/${encodeURIComponent(token)}`, { method: "POST" });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || `처리하지 못했습니다. (서버 응답 ${response.status})`);
      setDone(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="action-done">
        <p className="action-done-title">{label} 처리했습니다.</p>
        {done.reviewUrl && (
          <>
            <p>주문하신 분께 아래 후기 링크를 전달해 주세요. 한 번만 쓸 수 있습니다.</p>
            <code className="action-review-link">{done.reviewUrl}</code>
          </>
        )}
        <Link className="btn btn-line" href="/admin">주문 기록 보기</Link>
      </div>
    );
  }

  return (
    <div className="action-confirm">
      <button className="btn btn-solid" type="button" onClick={run} disabled={busy}>
        {busy ? "처리 중…" : `${label} 하기`}
      </button>
      <p className="action-note">
        {action === "reject"
          ? "거절하면 주문이 취소 상태가 됩니다."
          : action === "complete"
            ? "마감 처리하면 주문자가 후기를 남길 수 있는 링크가 만들어집니다."
            : "확인하면 주문이 작업 중 상태가 됩니다."}
      </p>
      {error && <p className="action-error">{error}</p>}
    </div>
  );
}
