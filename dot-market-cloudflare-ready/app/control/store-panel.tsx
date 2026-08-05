"use client";

import { useState } from "react";
import { readResult } from "../read-result";
import { StoreItem, StorePurchase } from "../../db/store";
import { MAX_PLANS, StorePlan, discountPercent, isOnSale, won } from "../../db/store-plans";

export default function StorePanel({
  initialItems, initialPurchases, initialChannelId, say, busy, setBusy,
}: {
  initialItems: StoreItem[];
  initialPurchases: StorePurchase[];
  initialChannelId: string;
  say: (text: string, kind?: "success" | "error") => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [items, setItems] = useState(initialItems);
  const [purchases, setPurchases] = useState(initialPurchases);
  const [channelId, setChannelId] = useState(initialChannelId);
  const [savedChannelId, setSavedChannelId] = useState(initialChannelId);
  const [newName, setNewName] = useState("");

  const patch = (id: string, change: Partial<StoreItem>) =>
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));

  const run = async (work: () => Promise<void>, failure: string) => {
    setBusy(true); say("");
    try { await work(); }
    catch (error) { say(error instanceof Error ? error.message : failure, "error"); }
    finally { setBusy(false); }
  };

  const addItem = () => run(async () => {
    const response = await fetch("/api/control/store/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName || "새 상품" }),
    });
    const result = await readResult<{ items: StoreItem[] }>(response, "상품을 만들지 못했습니다.");
    setItems(result.items);
    setNewName("");
    say("상품을 만들었습니다. 기간과 가격을 채우고 판매 중으로 바꿔주세요.");
  }, "상품을 만들지 못했습니다.");

  const saveItem = (item: StoreItem) => run(async () => {
    const response = await fetch(`/api/control/store/items/${item.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item),
    });
    const result = await readResult<{ items: StoreItem[] }>(response, "저장하지 못했습니다.");
    setItems(result.items);
    say(`${item.name} 저장했습니다.`);
  }, "저장하지 못했습니다.");

  const removeItem = (item: StoreItem) => {
    if (!window.confirm(`"${item.name}"을(를) 지웁니다. 되돌릴 수 없습니다.`)) return;
    void run(async () => {
      const response = await fetch(`/api/control/store/items/${item.id}`, { method: "DELETE" });
      const result = await readResult<{ items: StoreItem[] }>(response, "지우지 못했습니다.");
      setItems(result.items);
      say("상품을 지웠습니다.");
    }, "지우지 못했습니다.");
  };

  const saveChannel = () => run(async () => {
    const response = await fetch("/api/control/store/channel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId }),
    });
    await readResult(response, "채널을 저장하지 못했습니다.");
    setSavedChannelId(channelId);
    say(channelId ? "구매 알림 채널을 저장했습니다." : "구매 알림을 끕니다.");
  }, "채널을 저장하지 못했습니다.");

  const markPurchase = (purchase: StorePurchase, handled: boolean) => run(async () => {
    const response = await fetch(`/api/control/store/purchases/${purchase.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handled }),
    });
    const result = await readResult<{ purchases: StorePurchase[] }>(response, "처리하지 못했습니다.");
    setPurchases(result.purchases);
  }, "처리하지 못했습니다.");

  const removePurchase = (purchase: StorePurchase) => {
    if (!window.confirm(`${purchase.mcNick} 님의 "${purchase.itemName}" 요청을 지웁니다.`)) return;
    void run(async () => {
      const response = await fetch(`/api/control/store/purchases/${purchase.id}`, { method: "DELETE" });
      const result = await readResult<{ purchases: StorePurchase[] }>(response, "지우지 못했습니다.");
      setPurchases(result.purchases);
    }, "지우지 못했습니다.");
  };

  const setPlan = (item: StoreItem, index: number, change: Partial<StorePlan>) => {
    const plans = [...item.plans];
    plans[index] = { ...plans[index], ...change };
    patch(item.id, { plans });
  };

  const waiting = purchases.filter((purchase) => !purchase.handled).length;

  return (
    <>
      <div className="control-list-head">
        <h2>구매 요청</h2>
        <span>대기 {waiting}건 · 전체 {purchases.length}건</span>
      </div>
      <div className="application-list">
        {purchases.length === 0 ? (
          <p className="field-help">아직 들어온 구매 요청이 없습니다.</p>
        ) : purchases.map((purchase) => (
          <article key={purchase.id} className={purchase.handled ? "handled" : ""}>
            <div className="application-head">
              <b>{purchase.itemName}</b>
              <code>{purchase.planLabel}</code>
              <b className="store-price-tag">{won(purchase.price)}</b>
              {purchase.handled ? <em>처리함</em> : <i>대기 중</i>}
            </div>
            <div className="application-who">
              <span>{purchase.mcNick}</span>
              <code>{purchase.buyerName} · {purchase.buyerId}</code>
              <time dateTime={purchase.createdAt}>{purchase.createdAt.slice(0, 10)}</time>
            </div>
            {purchase.note && <p className="application-note">{purchase.note}</p>}
            <div className="application-actions">
              <button type="button" onClick={() => markPurchase(purchase, !purchase.handled)} disabled={busy}>
                {purchase.handled ? "대기로 되돌리기" : "처리함으로"}
              </button>
              <button type="button" className="danger" onClick={() => removePurchase(purchase)} disabled={busy}>
                삭제
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="control-list-head">
        <h2>상점 상품</h2>
        <span>{items.length}개 · 판매 중 {items.filter((item) => item.active).length}개</span>
      </div>

      <div className="store-admin">
        <label className="store-channel">
          구매 알림 채널 ID
          <span>
            <input
              inputMode="numeric"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              placeholder="비우면 알림을 보내지 않습니다"
            />
            <button type="button" onClick={saveChannel} disabled={busy || channelId === savedChannelId}>
              {channelId === savedChannelId ? "저장됨" : "채널 저장"}
            </button>
          </span>
          <small>봇이 글을 쓸 수 있는 채널이어야 합니다. 알림이 실패해도 요청은 위 목록에 남습니다.</small>
        </label>

        <label className="store-new">
          새 상품
          <span>
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={60}
              placeholder="상품 이름"
            />
            <button type="button" onClick={addItem} disabled={busy}>추가</button>
          </span>
          <small>만들면 판매 중지 상태로 들어갑니다. 가격을 채운 뒤 켜주세요.</small>
        </label>

        {items.map((item) => (
          <article className="store-admin-item" key={item.id}>
            <div className="field-grid">
              <label>상품 이름
                <input value={item.name} maxLength={60} onChange={(event) => patch(item.id, { name: event.target.value })}/>
              </label>
              <label>작은 머리말
                <input value={item.tagline} maxLength={30} placeholder="예: 기간제" onChange={(event) => patch(item.id, { tagline: event.target.value })}/>
              </label>
              <label className="wide">설명
                <textarea value={item.description} maxLength={600} rows={2} onChange={(event) => patch(item.id, { description: event.target.value })}/>
              </label>
            </div>

            <div className="tier-list">
              {item.plans.map((plan, index) => (
                <div className="tier-row" key={index}>
                  <label>기간<input value={plan.label} maxLength={20} placeholder="1일" onChange={(event) => setPlan(item, index, { label: event.target.value })}/></label>
                  <label>정가<input type="number" min={0} step={10000} value={plan.price} onChange={(event) => setPlan(item, index, { price: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })}/>원</label>
                  <label>할인가<input type="number" min={0} step={10000} value={plan.salePrice} onChange={(event) => setPlan(item, index, { salePrice: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })}/>원</label>
                  <small>{isOnSale(plan) ? `${discountPercent(plan)}% 할인으로 표시` : "0이면 할인 없음"}</small>
                  <button type="button" onClick={() => patch(item.id, { plans: item.plans.filter((_, at) => at !== index) })}>빼기</button>
                </div>
              ))}
              {item.plans.length < MAX_PLANS && (
                <button
                  type="button"
                  className="plain-upload-button"
                  onClick={() => patch(item.id, { plans: [...item.plans, { label: "", price: 0, salePrice: 0 }] })}
                >기간 추가</button>
              )}
              {item.plans.length === 0 && <p className="field-help">기간이 없으면 상점에 나오지 않습니다.</p>}
            </div>

            <div className="store-admin-foot">
              <label className="switch-row">
                <input type="checkbox" checked={item.active} onChange={(event) => patch(item.id, { active: event.target.checked })}/>
                <span>판매 중</span>
              </label>
              <label className="rank-row">표시 순서
                <input type="number" min={0} max={999} value={item.position} onChange={(event) => patch(item.id, { position: Math.max(0, Math.min(999, Math.trunc(Number(event.target.value) || 0))) })}/>
              </label>
              <div className="application-actions">
                <button type="button" className="danger" onClick={() => removeItem(item)} disabled={busy}>상품 삭제</button>
                <button type="button" onClick={() => saveItem(item)} disabled={busy}>저장</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
