"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { readResult } from "../../read-result";
import Link from "next/link";

const RATINGS = [1, 2, 3, 4, 5];

/** Matches the ceiling the review route enforces. */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export default function ReviewForm({
  orderId, shopSlug, playerName, initialRating, initialBody, hasExisting, initialPhotoUrl,
}: {
  orderId: string;
  shopSlug: string;
  playerName: string;
  initialRating: number;
  initialBody: string;
  hasExisting: boolean;
  /** The photo already attached, if the author added one before. */
  initialPhotoUrl: string | null;
}) {
  const [rating, setRating] = useState(initialRating);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<"saved" | "deleted" | null>(null);
  // The preview URL is made when the file is chosen rather than in an effect,
  // so the two can never disagree about which file is on screen.
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  const shownPhoto = photo?.url ?? (removePhoto ? null : initialPhotoUrl);

  const pickPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!chosen) return;
    if (chosen.size > MAX_PHOTO_BYTES) {
      setError("사진은 6MB까지 올릴 수 있습니다.");
      return;
    }
    if (photo) URL.revokeObjectURL(photo.url);
    setError("");
    setRemovePhoto(false);
    setPhoto({ file: chosen, url: URL.createObjectURL(chosen) });
  };

  const clearPhoto = () => {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setRemovePhoto(true);
  };

  const send = async (method: "POST" | "DELETE") => {
    setBusy(true); setError("");
    try {
      // Multipart, because the photo travels with the rest of the review. The
      // browser sets the boundary itself, so no content-type is passed here.
      let form: FormData | undefined;
      if (method === "POST") {
        form = new FormData();
        form.set("rating", String(rating));
        form.set("body", body);
        if (photo) form.set("photo", photo.file);
        if (removePhoto) form.set("removePhoto", "1");
      }
      const response = await fetch(`/api/review/${encodeURIComponent(orderId)}`, { method, body: form });
      await readResult(response, "처리하지 못했습니다.");
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

      <div className="review-photo">
        <div className="review-photo-head">
          <span>사진 <small>선택</small></span>
          <small>완성된 그림을 찍어 올리면 다음 손님에게 도움이 됩니다. 6MB까지.</small>
        </div>
        {shownPhoto ? (
          <div className="review-photo-preview">
            {/* A local object URL before saving, the stored photo after. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shownPhoto} alt="후기에 첨부한 사진"/>
            <button
              type="button"
              onClick={clearPhoto}
              disabled={busy}
            >
              사진 빼기
            </button>
          </div>
        ) : (
          <label className="review-photo-pick">
            사진 고르기
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={pickPhoto} disabled={busy}/>
          </label>
        )}
      </div>

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
