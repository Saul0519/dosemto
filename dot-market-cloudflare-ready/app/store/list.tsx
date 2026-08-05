"use client";

import { useState } from "react";
import Link from "next/link";
import { readResult } from "../read-result";
import { StoreItem } from "../../db/store";
import { StorePlan, discountPercent, effectivePrice, isOnSale, won } from "../../db/store-plans";

type Chosen = { item: StoreItem; plan: StorePlan };

export default function StoreList({ items, signedIn, buyerName }: {
  items: StoreItem[];
  signedIn: boolean;
  buyerName: string;
}) {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [mcNick, setMcNick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Chosen | null>(null);

  const buy = async () => {
    if (!chosen) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/store/purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: chosen.item.id, planLabel: chosen.plan.label, mcNick, note }),
      });
      await readResult(response, "구매 요청을 보내지 못했습니다.");
      setDone(chosen);
      setChosen(null);
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "구매 요청을 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="store-done">
        <b>구매 요청을 보냈습니다.</b>
        <p>
          {done.item.name} · {done.plan.label} · {won(effectivePrice(done.plan))}
        </p>
        <p>운영자가 확인한 뒤 게임 안에서 <b>{mcNick}</b> 님께 연락드립니다. 대금은 그때 주고받습니다.</p>
        <button type="button" className="btn btn-line" onClick={() => setDone(null)}>상점으로 돌아가기</button>
      </div>
    );
  }

  return (
    <>
      <div className="store-grid">
        {items.map((item) => (
          <article className="store-card" key={item.id}>
            {item.tagline && <p className="store-tagline">{item.tagline}</p>}
            <h3>{item.name}</h3>
            {item.description && <p className="store-desc">{item.description}</p>}

            <ul className="store-plans">
              {item.plans.map((plan) => {
                const sale = isOnSale(plan);
                return (
                  <li key={plan.label} className={sale ? "on-sale" : ""}>
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
                      onClick={() => { setChosen({ item, plan }); setError(""); }}
                    >
                      구매
                    </button>
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>

      {chosen && (
        <div
          className="store-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${chosen.item.name} 구매`}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setChosen(null); }}
        >
          <div className="store-modal-box">
            <p className="eyebrow">구매 요청</p>
            <h3>{chosen.item.name}</h3>
            <p className="store-modal-price">
              {chosen.plan.label} · <strong>{won(effectivePrice(chosen.plan))}</strong>
              {isOnSale(chosen.plan) && <s>{won(chosen.plan.price)}</s>}
            </p>

            {signedIn ? (
              <>
                <div className="apply-auto">
                  <span>디스코드</span>
                  <b>{buyerName}</b>
                  <small>운영자가 이 계정으로 연락드립니다.</small>
                </div>

                <label>
                  도스 닉네임
                  <input
                    value={mcNick}
                    onChange={(event) => { setMcNick(event.target.value); setError(""); }}
                    maxLength={16}
                    placeholder="물건 받을 계정"
                  />
                  <small>영문·숫자·밑줄(_) 3~16자. 이 계정으로 전달됩니다.</small>
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
                  디스코드로 로그인한 뒤 구매할 수 있습니다. 운영자가 연락할 곳이 있어야 하고,
                  다른 사람 이름으로 요청하는 것도 막을 수 있습니다.
                </p>
                <div className="store-modal-actions">
                  <button type="button" className="btn btn-line" onClick={() => setChosen(null)}>취소</button>
                  <Link className="btn btn-solid" href={`/login?next=${encodeURIComponent("/store")}`}>
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
