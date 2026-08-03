"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

const RATINGS = [1, 2, 3, 4, 5];

export default function ReviewForm({
  orderId, shopSlug, playerName, initialRating, initialBody, hasExisting,
}: {
  orderId: string;
  shopSlug: string;
  playerName: string;
  initialRating: number;
  initialBody: string;
  hasExisting: boolean;
}) {
  const [rating, setRating] = useState(initialRating);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<"saved" | "deleted" | null>(null);

  const send = async (method: "POST" | "DELETE") => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/review/${encodeURIComponent(orderId)}`, {
        method,
        ...(method === "POST"
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ rating, body }) }
          : {}),
      });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || `처리하지 못했습니다. (서버 응답 ${response.status})`);
      setDone(method === "POST" ? "saved" : "deleted");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (rating === 0) { setError("별점을 골라주세요."); return; }
    void send("POST");
  };

  if (done) {
    return (
      <div className="action-done">
        <p className="action-done-title">
          {done === "saved" ? "후기를 저장했습니다." : "후기를 지웠습니다."}
        </p>
        <p>
          {done === "saved"
            ? "샵 소개 페이지에 바로 표시됩니다. 언제든 다시 고치실 수 있습니다."
            : "같은 주문에 다시 남기실 수 있습니다."}
        </p>
        <Link className="btn btn-line" href={`/shop/${shopSlug}/about`}>샵 소개 보기</Link>
        <Link className="btn btn-line" href="/me">내 주문 보기</Link>
      </div>
    );
  }

  return (
    <form className="review-form" onSubmit={submit}>
      <fieldset className="rating-picker">
        <legend>별점</legend>
        {RATINGS.map((value) => (
          <button
            type="button"
            key={value}
            className={value <= rating ? "on" : ""}
            aria-label={`${value}점`}
            aria-pressed={value === rating}
            onClick={() => { setRating(value); setError(""); }}
          >
            ★
          </button>
        ))}
        <span>{rating > 0 ? `${rating}점` : "고르지 않음"}</span>
      </fieldset>

      <div className="review-author">
        <span>표시할 이름</span>
        <b>{playerName}</b>
        <small>로그인한 디스코드 계정 이름입니다. 바꿀 수 없습니다.</small>
      </div>

      <label>
        후기 <small>선택</small>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={1000}
          rows={5}
          placeholder="어떤 점이 좋았는지, 아쉬웠는지 적어주세요."
        />
      </label>

      <button className="btn btn-solid" disabled={busy}>
        {busy ? "저장 중…" : hasExisting ? "후기 수정" : "후기 남기기"}
      </button>
      {hasExisting && (
        <button type="button" className="btn btn-line danger" disabled={busy} onClick={() => void send("DELETE")}>
          후기 삭제
        </button>
      )}
      {error && <p className="action-error">{error}</p>}
    </form>
  );
}
