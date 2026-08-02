"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

const RATINGS = [1, 2, 3, 4, 5];

export default function ReviewForm({ token, shopSlug, playerName }: {
  token: string;
  shopSlug: string;
  playerName: string;
}) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (rating === 0) { setError("별점을 골라주세요."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/review/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, body }),
      });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || `보내지 못했습니다. (서버 응답 ${response.status})`);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="action-done">
        <p className="action-done-title">후기를 남겼습니다.</p>
        <p>샵 소개 페이지에 바로 표시됩니다. 고맙습니다.</p>
        <Link className="btn btn-line" href={`/shop/${shopSlug}/about`}>샵 소개 보기</Link>
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
        <small>로그인한 마인크래프트 계정 이름입니다. 바꿀 수 없습니다.</small>
      </div>

      <label>
        후기 <small>선택</small>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={5} placeholder="어떤 점이 좋았는지, 아쉬웠는지 적어주세요."/>
      </label>

      <button className="btn btn-solid" disabled={busy}>{busy ? "보내는 중…" : "후기 남기기"}</button>
      {error && <p className="action-error">{error}</p>}
    </form>
  );
}
