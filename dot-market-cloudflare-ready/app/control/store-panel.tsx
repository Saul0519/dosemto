"use client";

import { ChangeEvent, useState } from "react";
import { readResult } from "../read-result";
import type { StoreItem, StorePurchase } from "../../db/store";
import type { ModeratedStoreReview } from "../../db/store-reviews";
import {
  MAX_ITEM_IMAGES, MAX_PLANS, SALE_COLOURS, StorePlan,
  discountPercent, isOnSale, readableOn, won,
} from "../../db/store-plans";

export default function StorePanel({
  initialItems, initialPurchases, initialReviews, initialChannelId, say, busy, setBusy,
}: {
  initialItems: StoreItem[];
  initialPurchases: StorePurchase[];
  initialReviews: ModeratedStoreReview[];
  initialChannelId: string;
  say: (text: string, kind?: "success" | "error") => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [items, setItems] = useState(initialItems);
  const [purchases, setPurchases] = useState(initialPurchases);
  const [reviews, setReviews] = useState(initialReviews);
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
    if (!window.confirm(`"${item.name}"을(를) 지웁니다. 사진과 후기도 함께 사라지고 되돌릴 수 없습니다.\n구매 기록은 남습니다.`)) return;
    void run(async () => {
      const response = await fetch(`/api/control/store/items/${item.id}`, { method: "DELETE" });
      const result = await readResult<{ items: StoreItem[] }>(response, "지우지 못했습니다.");
      setItems(result.items);
      say("상품을 지웠습니다.");
    }, "지우지 못했습니다.");
  };

  const uploadShots = (item: StoreItem, event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    const form = new FormData();
    files.forEach((file) => form.append("images", file));
    void run(async () => {
      const response = await fetch(`/api/control/store/items/${item.id}/images`, { method: "POST", body: form });
      const result = await readResult<{ items: StoreItem[] }>(response, "사진을 올리지 못했습니다.");
      // Only the pictures come back from the server; anything being typed stays.
      applyImages(result.items);
      say("사진을 올렸습니다.");
    }, "사진을 올리지 못했습니다.").finally(() => { input.value = ""; });
  };

  const removeShot = (item: StoreItem, imageId: string) => run(async () => {
    const response = await fetch(`/api/control/store/items/${item.id}/images/${imageId}`, { method: "DELETE" });
    const result = await readResult<{ items: StoreItem[] }>(response, "사진을 지우지 못했습니다.");
    applyImages(result.items);
    say("사진을 지웠습니다.");
  }, "사진을 지우지 못했습니다.");

  /** Takes the picture lists off the server copy and leaves every edited field alone. */
  const applyImages = (fresh: StoreItem[]) => {
    const byId = new Map(fresh.map((item) => [item.id, item.images] as const));
    setItems((current) => current.map((item) => ({ ...item, images: byId.get(item.id) ?? item.images })));
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
    say(handled ? "전달 완료로 옮겼습니다. 이제 구매자가 후기를 남길 수 있습니다." : "다시 대기로 되돌렸습니다.");
  }, "처리하지 못했습니다.");

  const removePurchase = (purchase: StorePurchase) => {
    if (!window.confirm(`${purchase.mcNick} 님의 "${purchase.itemName}" 요청을 지웁니다.`)) return;
    void run(async () => {
      const response = await fetch(`/api/control/store/purchases/${purchase.id}`, { method: "DELETE" });
      const result = await readResult<{ purchases: StorePurchase[] }>(response, "지우지 못했습니다.");
      setPurchases(result.purchases);
    }, "지우지 못했습니다.");
  };

  const toggleReview = (review: ModeratedStoreReview) => run(async () => {
    const response = await fetch(`/api/control/store/reviews/${encodeURIComponent(review.orderNo)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hidden: !review.hidden }),
    });
    const result = await readResult<{ reviews: ModeratedStoreReview[] }>(response, "바꾸지 못했습니다.");
    setReviews(result.reviews);
    say(review.hidden ? "후기를 다시 보이게 했습니다." : "후기를 숨겼습니다.");
  }, "바꾸지 못했습니다.");

  const purgeReview = (review: ModeratedStoreReview) => {
    if (!window.confirm(`${review.displayName} 님의 후기를 완전히 지웁니다. 되돌릴 수 없습니다.`)) return;
    void run(async () => {
      const response = await fetch(`/api/control/store/reviews/${encodeURIComponent(review.orderNo)}`, { method: "DELETE" });
      const result = await readResult<{ reviews: ModeratedStoreReview[] }>(response, "지우지 못했습니다.");
      setReviews(result.reviews);
      say("후기를 지웠습니다.");
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
        <h2>상점 구매 요청</h2>
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
              {purchase.handled ? <em>전달 완료</em> : <i>대기 중</i>}
            </div>
            <div className="application-who">
              <span>{purchase.mcNick}</span>
              <code>{purchase.buyerName} · {purchase.buyerId}</code>
              <code>주문 {purchase.orderNo}</code>
              <time dateTime={purchase.createdAt}>{purchase.createdAt.slice(0, 10)}</time>
            </div>
            {purchase.note && <p className="application-note">{purchase.note}</p>}
            <div className="application-actions">
              <button type="button" onClick={() => markPurchase(purchase, !purchase.handled)} disabled={busy}>
                {purchase.handled ? "대기로 되돌리기" : "전달 완료로"}
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
              <label className="wide">한 줄 소개
                <textarea value={item.description} maxLength={600} rows={2} onChange={(event) => patch(item.id, { description: event.target.value })}/>
                <small>목록 카드에 나옵니다.</small>
              </label>
              <label className="wide">자세한 설명
                <textarea value={item.detail} maxLength={4000} rows={6} onChange={(event) => patch(item.id, { detail: event.target.value })}/>
                <small>상품을 눌러 들어갔을 때 나옵니다. 줄바꿈은 그대로 살아납니다.</small>
              </label>
            </div>

            <div className="store-shot-admin">
              <div className="store-shot-list">
                {item.images.map((image) => (
                  <figure key={image.id}>
                    <img src={`/api/store-images/${image.id}`} alt={image.filename}/>
                    <button type="button" onClick={() => removeShot(item, image.id)} disabled={busy} aria-label="사진 지우기">×</button>
                  </figure>
                ))}
                {item.images.length < MAX_ITEM_IMAGES && (
                  <label className="store-shot-add">
                    <input type="file" accept="image/*" multiple onChange={(event) => uploadShots(item, event)} disabled={busy}/>
                    <span>사진 추가</span>
                  </label>
                )}
              </div>
              <small className="field-help">첫 번째 사진이 목록 카드에 나옵니다. 최대 {MAX_ITEM_IMAGES}장.</small>
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

            <div className="sale-colour">
              <span className="sale-colour-title">할인 색깔</span>
              <div className="sale-colour-picks">
                {SALE_COLOURS.map((colour) => (
                  <button
                    type="button"
                    key={colour.hex}
                    className={item.saleColour === colour.hex ? "on" : ""}
                    style={{ background: colour.hex }}
                    title={colour.name}
                    aria-label={colour.name}
                    aria-pressed={item.saleColour === colour.hex}
                    onClick={() => patch(item.id, { saleColour: colour.hex })}
                  />
                ))}
                <input
                  type="color"
                  value={item.saleColour}
                  onChange={(event) => patch(item.id, { saleColour: event.target.value.toUpperCase() })}
                  aria-label="직접 고르기"
                />
              </div>
              <b
                className="store-sale-badge"
                style={{ "--sale": item.saleColour, "--on-sale": readableOn(item.saleColour) } as React.CSSProperties}
              >
                30% 할인
              </b>
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

      <div className="control-list-head">
        <h2>상점 후기</h2>
        <span>{reviews.length}개 · 숨김 {reviews.filter((review) => review.hidden).length}개</span>
      </div>
      <div className="application-list">
        {reviews.length === 0 ? (
          <p className="field-help">아직 상점 후기가 없습니다.</p>
        ) : reviews.map((review) => (
          <article key={review.id} className={review.hidden ? "handled" : ""}>
            <div className="application-head">
              <b>{review.itemName}</b>
              <code>★ {review.rating}</code>
              {review.hidden && <em>숨김</em>}
            </div>
            <div className="application-who">
              <span>{review.displayName}</span>
              <code>주문 {review.orderNo}</code>
              <time dateTime={review.updatedAt}>{review.updatedAt.slice(0, 10)}</time>
            </div>
            {review.body && <p className="application-note">{review.body}</p>}
            <div className="application-actions">
              <button type="button" onClick={() => toggleReview(review)} disabled={busy}>
                {review.hidden ? "다시 보이기" : "숨기기"}
              </button>
              <button type="button" className="danger" onClick={() => purgeReview(review)} disabled={busy}>
                완전 삭제
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
