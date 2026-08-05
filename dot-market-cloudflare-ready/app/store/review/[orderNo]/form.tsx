"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { readResult } from "../../../read-result";

export default function StoreReviewForm({
  orderNo, itemId, buyerName, initialRating, initialBody, hasExisting,
}: {
  orderNo: string;
  itemId: string;
  buyerName: string;
  initialRating: number;
  initialBody: string;
  hasExisting: boolean;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(initialRating);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (rating < 1) { setError("별점을 골라주세요."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/store/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderNo, rating, body }),
      });
      await readResult(response, "후기를 저장하지 못했습니다.");
      router.push(`/store/${itemId}#store-reviews`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "후기를 저장하지 못했습니다.");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("후기를 지웁니다. 되돌릴 수 없습니다.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/store/reviews?orderNo=${encodeURIComponent(orderNo)}`, { method: "DELETE" });
      await readResult(response, "후기를 지우지 못했습니다.");
      router.push(`/store/${itemId}#store-reviews`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "후기를 지우지 못했습니다.");
      setBusy(false);
    }
  };

  return (
    <form className="review-form" onSubmit={submit}>
      {/* Same picker as the shop review form: one row of stars that fill in, not
          five stacked radio buttons. */}
      <fieldset className="rating-picker">
        <legend>별점</legend>
        {[1, 2, 3, 4, 5].map((value) => (
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
        <b>{buyerName}</b>
        <small>로그인한 디스코드 계정 이름입니다. 바꿀 수 없습니다.</small>
      </div>

      <label>
        하고 싶은 말 <small>선택</small>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={1000}
          rows={5}
          placeholder="써보니 어땠는지 적어주세요. 다음 사람이 고르는 데 도움이 됩니다."
        />
      </label>

      <button className="btn btn-solid" disabled={busy}>
        {busy ? "저장 중…" : hasExisting ? "후기 고치기" : "후기 남기기"}
      </button>
      {hasExisting && (
        <button type="button" className="btn btn-line danger" onClick={remove} disabled={busy}>
          후기 지우기
        </button>
      )}
      {error && <p className="action-error">{error}</p>}
    </form>
  );
}
