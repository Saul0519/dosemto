"use client";

import { useState } from "react";
import Link from "next/link";
import { readResult } from "../../read-result";
import type { StoreItem } from "../../../db/store";
import { StorePlan, discountPercent, effectivePrice, isOnSale, readableOn, won } from "../../../db/store-plans";
import type { CSSProperties } from "react";

export default function BuyPanel({ item, signedIn, buyerName, soldOut }: {
  item: StoreItem;
  signedIn: boolean;
  buyerName: string;
  /** Every slot is taken, so there is nothing to sell right now. */
  soldOut: boolean;
}) {
  const [chosen, setChosen] = useState<StorePlan | null>(null);
  const [mcNick, setMcNick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<StorePlan | null>(null);
  // Comes back with the receipt, already rendered by the server.
  const [receipt, setReceipt] = useState<{ orderNo: string; licence: string } | null>(null);
  const [read, setRead] = useState(false);

  const buy = async () => {
    if (!chosen) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/store/purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, planLabel: chosen.label, mcNick, note }),
      });
      const result = await readResult<{ orderNo?: string; licence?: string }>(
        response, "구매 요청을 보내지 못했습니다.");
      setReceipt({ orderNo: result.orderNo ?? "", licence: result.licence ?? "" });
      setRead(false);
      setDone(chosen);
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "구매 요청을 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  // The terms come up before anything else and stay up until they are
  // acknowledged. Somebody who has just paid is the one moment they will read.
  if (done && receipt?.licence && !read) {
    return (
      <div className="store-modal" role="dialog" aria-modal="true" aria-label="이용 안내">
        <div className="deed deed-modal">
          <div className="deed-band">
            <p className="deed-kind">이용 안내 · TERMS OF USE</p>
            <h3>{item.name}</h3>
          </div>
          <dl className="deed-meta">
            <div><dt>주문번호</dt><dd><code>{receipt.orderNo}</code></dd></div>
            <div><dt>발급 대상</dt><dd>{buyerName}</dd></div>
          </dl>
          <div className="deed-body" dangerouslySetInnerHTML={{ __html: receipt.licence }}/>
          <p className="deed-seal">
            이 안내는 <b>{buyerName}</b> 님의 주문 <code>{receipt.orderNo}</code>에 대해
            발급되었습니다. 발급 기록은 서버에 남습니다.
          </p>
          <div className="deed-foot">
            <button type="button" className="btn btn-solid" onClick={() => setRead(true)}>
              읽었습니다
            </button>
            <span>나중에 다시 보려면 내 주문 → 이용 안내</span>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="store-done">
        <b>구매 요청을 보냈습니다.</b>
        <p>{item.name} · {done.label} · {won(effectivePrice(done))}</p>
        <p>
          운영자가 확인하면 게임 안에서 <b>{mcNick}</b> 님께 연락드립니다. 돈을 받은 뒤
          모드 파일과 라이선스 코드를 보내드려요.
        </p>
        <p className="store-done-where">
          주문번호와 진행 상황은 <Link href="/me">내 주문</Link>에서 볼 수 있습니다.
          {receipt?.licence && receipt.orderNo && (
            <> 이용 안내는 <Link href={`/store/licence/${receipt.orderNo}`}>여기</Link>에서 다시 볼 수 있습니다.</>
          )}
        </p>
        <button type="button" className="btn btn-line" onClick={() => { setDone(null); setChosen(null); }}>
          다른 기간도 보기
        </button>
      </div>
    );
  }

  return (
    <>
      <ul className="store-plans">
        {item.plans.map((plan) => {
          const sale = isOnSale(plan);
          return (
            <li
              key={plan.label}
              className={sale ? "on-sale" : ""}
              style={{ "--sale": plan.colour, "--on-sale": readableOn(plan.colour) } as CSSProperties}
            >
              <span className="store-plan-label">{plan.label}</span>
              <span className="store-plan-price">
                {sale && (
                  <>
                    <b className="store-sale-badge">{discountPercent(plan)}% 할인</b>
                    <s>{won(plan.price)}</s>
                  </>
                )}
                <strong>{won(effectivePrice(plan))}</strong>
              </span>
              <button
                type="button"
                disabled={soldOut}
                onClick={() => { setChosen(plan); setError(""); }}
              >{soldOut ? "마감" : "구매"}</button>
            </li>
          );
        })}
      </ul>

      {chosen && (
        <div
          className="store-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${item.name} 구매`}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setChosen(null); }}
        >
          <div className="store-modal-box">
            <p className="eyebrow">구매 요청</p>
            <h3>{item.name}</h3>
            <p
              className="store-modal-price"
              style={{ "--sale": chosen.colour } as CSSProperties}
            >
              {chosen.label} · <strong>{won(effectivePrice(chosen))}</strong>
              {isOnSale(chosen) && <s>{won(chosen.price)}</s>}
            </p>

            {signedIn ? (
              <>
                <div className="apply-auto">
                  <span>디스코드</span>
                  <b>{buyerName}</b>
                  <small>여기로 라이선스 코드를 보내드립니다.</small>
                </div>

                <label>
                  도스 닉네임
                  <input
                    value={mcNick}
                    onChange={(event) => { setMcNick(event.target.value); setError(""); }}
                    maxLength={16}
                    placeholder="게임에서 쓰는 이름"
                  />
                  <small>영문·숫자·밑줄(_) 3~16자.</small>
                </label>

                <label>
                  남길 말 <small>선택</small>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={300}
                    rows={2}
                    placeholder="접속 가능한 시간 같은 걸 적어주세요."
                  />
                </label>

                <div className="store-modal-actions">
                  <button type="button" className="btn btn-line" onClick={() => setChosen(null)} disabled={busy}>
                    취소
                  </button>
                  <button type="button" className="btn btn-solid" onClick={buy} disabled={busy}>
                    {busy ? "보내는 중…" : "구매 요청 보내기"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="store-modal-note">
                  라이선스 코드를 보내드려야 해서 디스코드 로그인이 필요합니다.
                </p>
                <div className="store-modal-actions">
                  <button type="button" className="btn btn-line" onClick={() => setChosen(null)}>취소</button>
                  <Link className="btn btn-solid" href={`/login?next=${encodeURIComponent(`/store/${item.id}`)}`}>
                    디스코드로 로그인 <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </>
            )}

            {error && <p className="action-error">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
