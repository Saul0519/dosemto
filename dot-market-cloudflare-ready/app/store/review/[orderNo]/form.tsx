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
      <fieldset className="star-pick">
        <legend>별점</legend>
        {[1, 2, 3, 4, 5].map((value) => (
          <label key={value} className={value <= rating ? "on" : ""}>
            <input
              type="radio"
              name="rating"
              value={value}
              checked={rating === value}
              onChange={() => { setRating(value); setError(""); }}
            />
            <span aria-hidden="true">★</span>
            <b>{value}점</b>
          </label>
        ))}
      </fieldset>

      <label className="review-body">
        하고 싶은 말 <small>선택</small>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={1000}
          rows={5}
          placeholder="써보니 어땠는지 적어주세요. 다음 사람이 고르는 데 도움이 됩니다."
        />
        <small>{buyerName} 이름으로 올라갑니다.</small>
      </label>

      {error && <p className="action-error">{error}</p>}

      <div className="review-actions">
        {hasExisting && (
          <button type="button" className="btn btn-line danger" onClick={remove} disabled={busy}>
            후기 지우기
          </button>
        )}
        <button type="submit" className="btn btn-solid" disabled={busy}>
          {busy ? "저장 중…" : hasExisting ? "후기 고치기" : "후기 남기기"}
        </button>
      </div>
    </form>
  );
}
