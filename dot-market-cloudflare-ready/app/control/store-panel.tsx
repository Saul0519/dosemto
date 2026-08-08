"use client";

import { ChangeEvent, useState } from "react";
import type { CSSProperties } from "react";
import { readResult } from "../read-result";
import SortableImages from "../sortable-images";
import type { StoreItem, StorePurchase } from "../../db/store";
import type { ModeratedStoreReview } from "../../db/store-reviews";
import {
  DEFAULT_SALE_COLOUR, MAX_ITEM_IMAGES, MAX_PLANS, SALE_COLOURS, StorePlan,
  discountPercent, isOnSale, readableOn, won,
} from "../../db/store-plans";

/**
 * A starting point for the terms, so the box is not blank. Every word of it is
 * the owner's to change — it is only ever inserted when they ask.
 */
const LICENCE_TEMPLATE = `## 저작권 안내

이 상품은 제작자의 저작물입니다. **저작권은 만든 때부터 자동으로 생깁니다.**
등록이나 ⓒ 표시 같은 절차가 필요하지 않습니다. (저작권법 제10조 제2항)

구매하시면 **본인 계정으로 쓸 권리**를 받는 것이고, 파일에 대한 권리를 사는 것이 아닙니다.

**해도 되는 것**
- 본인 계정에서 쓰기
- 받은 파일을 그대로 보관하기

**하면 안 되는 것**
- 파일이나 라이선스 코드를 남에게 주거나 올리는 것
- 코드나 그 일부를 가져다 다른 프로그램에 쓰는 것
- 파일을 고치거나 고친 것을 배포하는 것
- 되팔거나 다른 서비스에 끼워 파는 것

## 어기실 경우

저작재산권을 복제·배포·2차적저작물 작성 등의 방법으로 침해하면
**5년 이하의 징역 또는 5천만원 이하의 벌금**에 처해질 수 있고, 두 형을 함께 부과할 수도 있습니다.
(저작권법 제136조 제1항)

라이선스 검사를 없애려고 역분석하는 것은 호환 목적이 아니므로 허용 범위에 들어가지 않습니다.
(저작권법 제101조의4)

## 기록

라이선스 서버에 **발급·사용·계정 연결 기록이 남습니다.**
코드는 처음 쓴 계정에 묶이고, 그 뒤 접속도 계정별로 쌓입니다.
코드를 남에게 주면 그 사람이 시도한 순간 계정과 함께 기록에 남습니다.

## 끝으로

겁주려고 쓴 글이 아니라, 모르고 하시는 분이 없도록 미리 적어두는 것입니다.
궁금한 점이나 계정을 바꾸셔야 하는 경우는 언제든 편하게 말씀해주세요.`;

export default function StorePanel({
  initialItems, initialPurchases, initialReviews, initialChannelId, initialGuildId,
  licenceServer, say, busy, setBusy,
}: {
  initialItems: StoreItem[];
  initialPurchases: StorePurchase[];
  initialReviews: ModeratedStoreReview[];
  initialChannelId: string;
  initialGuildId: string;
  licenceServer: { url: string; hasToken: boolean };
  say: (text: string, kind?: "success" | "error") => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [items, setItems] = useState(initialItems);
  const [purchases, setPurchases] = useState(initialPurchases);
  const [reviews, setReviews] = useState(initialReviews);
  const [channelId, setChannelId] = useState(initialChannelId);
  const [savedChannelId, setSavedChannelId] = useState(initialChannelId);
  const [guildId, setGuildId] = useState(initialGuildId);
  const [savedGuildId, setSavedGuildId] = useState(initialGuildId);
  const [newName, setNewName] = useState("");
  const [licenceUrl, setLicenceUrl] = useState(licenceServer.url);
  const [savedLicenceUrl, setSavedLicenceUrl] = useState(licenceServer.url);
  // Never filled from the server: a stored secret is not sent back to the page.
  const [licenceToken, setLicenceToken] = useState("");
  const [hasToken, setHasToken] = useState(licenceServer.hasToken);

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

  const reorderShots = (item: StoreItem, order: string[]) => run(async () => {
    const response = await fetch(`/api/control/store/items/${item.id}/images`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order }),
    });
    const result = await readResult<{ items: StoreItem[] }>(response, "순서를 바꾸지 못했습니다.");
    applyImages(result.items);
    say("순서를 저장했습니다. 맨 앞 사진이 목록 카드에 나옵니다.");
  }, "순서를 바꾸지 못했습니다.");

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

  const saveGuild = () => run(async () => {
    const response = await fetch("/api/control/store/guild", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId }),
    });
    await readResult(response, "서버를 저장하지 못했습니다.");
    setSavedGuildId(guildId);
    say(guildId ? "이제 주문에 그 서버의 역할이 함께 표시됩니다." : "역할 표시를 껐습니다.");
  }, "서버를 저장하지 못했습니다.");

  const forgetRoles = () => {
    if (!window.confirm("지금까지 기록된 역할을 모두 지웁니다. 되돌릴 수 없습니다.\n주문 기록 자체는 그대로 남습니다.")) return;
    void run(async () => {
      const response = await fetch("/api/control/store/guild", { method: "DELETE" });
      const result = await readResult<{ cleared: number }>(response, "지우지 못했습니다.");
      setPurchases((current) => current.map((purchase) => ({ ...purchase, roles: [] })));
      say(`역할 기록 ${result.cleared}건을 지웠습니다.`);
    }, "지우지 못했습니다.");
  };

  const saveLicenceServer = () => run(async () => {
    const response = await fetch("/api/control/store/licence-server", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: licenceUrl, ...(licenceToken ? { token: licenceToken } : {}) }),
    });
    const result = await readResult<{ url: string; hasToken: boolean }>(response, "저장하지 못했습니다.");
    setSavedLicenceUrl(result.url);
    setHasToken(result.hasToken);
    setLicenceToken("");
    say(result.url ? "라이선스 서버를 저장했습니다. 연결 확인을 눌러보세요." : "라이선스 연동을 껐습니다.");
  }, "저장하지 못했습니다.");

  const testLicenceServer = () => run(async () => {
    const response = await fetch("/api/control/store/licence-server", { method: "POST" });
    const result = await readResult<{ count: number; byState: Record<string, number> }>(
      response, "확인하지 못했습니다.");
    const states = Object.entries(result.byState).map(([state, n]) => `${state} ${n}`).join(" · ");
    say(`라이선스 ${result.count}개를 읽었습니다.${states ? ` (${states})` : ""}`);
  }, "확인하지 못했습니다.");

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
            {purchase.roles.length > 0 && (
              <div className="purchase-roles">
                {purchase.roles.map((role) => <b key={role}>{role}</b>)}
              </div>
            )}
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

        <label className="store-channel">
          역할을 볼 디스코드 서버 ID
          <span>
            <input
              inputMode="numeric"
              value={guildId}
              onChange={(event) => setGuildId(event.target.value)}
              placeholder="비우면 역할을 보지 않습니다"
            />
            <button type="button" onClick={saveGuild} disabled={busy || guildId === savedGuildId}>
              {guildId === savedGuildId ? "저장됨" : "서버 저장"}
            </button>
          </span>
          <small>
            주문한 사람이 이 서버에서 어떤 역할을 갖고 있는지 알림과 위 목록에 함께 표시됩니다.
            봇이 그 서버에 들어가 있어야 읽을 수 있고, 비우면 그때부터 보지 않습니다.
            이미 기록된 것은 그대로 남으니 지우려면 아래 버튼을 쓰세요.
          </small>
          <span>
            <button type="button" className="danger" onClick={forgetRoles} disabled={busy}>
              기록된 역할 모두 지우기
            </button>
          </span>
        </label>

        <label className="store-channel">
          라이선스 서버 주소
          <span>
            <input
              value={licenceUrl}
              onChange={(event) => setLicenceUrl(event.target.value)}
              placeholder="https://…/api/list (비우면 연동 끔)"
            />
            <button type="button" onClick={saveLicenceServer} disabled={busy || (licenceUrl === savedLicenceUrl && !licenceToken)}>
              {licenceUrl === savedLicenceUrl && !licenceToken ? "저장됨" : "주소 저장"}
            </button>
          </span>
          <span>
            <input
              type="password"
              value={licenceToken}
              onChange={(event) => setLicenceToken(event.target.value)}
              placeholder={hasToken ? "토큰 저장됨 · 바꾸려면 새로 입력" : "토큰 (필요하면)"}
              autoComplete="off"
            />
            <button type="button" onClick={testLicenceServer} disabled={busy || !savedLicenceUrl}>
              연결 확인
            </button>
          </span>
          <small>
            라이선스 서버의 <code>/api/list</code> 주소와 <code>MARKET_TOKEN</code>입니다.
            여기서 읽은 살아있는 라이선스 수만큼 상품의 자리가 자동으로 찹니다. 만료·정지된
            것은 세지 않으므로 기간이 끝나면 그 자리가 다시 열립니다. 비워두면 자동으로 차지
            않고 수동 값만 씁니다.
          </small>
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
            <div className="item-fields">
              <label>
                <span>상품 이름</span>
                <input value={item.name} maxLength={60} onChange={(event) => patch(item.id, { name: event.target.value })}/>
              </label>
              <label>
                <span>작은 머리말</span>
                <input value={item.tagline} maxLength={30} placeholder="예: 기간제" onChange={(event) => patch(item.id, { tagline: event.target.value })}/>
              </label>
              <label className="wide">
                <span>한 줄 소개 <small>목록 카드에 나옵니다</small></span>
                <textarea value={item.description} maxLength={600} rows={2} onChange={(event) => patch(item.id, { description: event.target.value })}/>
              </label>
              <label className="wide">
                <span>자세한 설명 <small>상품을 눌러 들어갔을 때. 줄바꿈 그대로 살아납니다</small></span>
                <textarea value={item.detail} maxLength={4000} rows={7} onChange={(event) => patch(item.id, { detail: event.target.value })}/>
              </label>
              <label className="wide">
                <span>
                  이용 안내 <small>구매한 사람에게만 보입니다. 마크다운(## 제목, **굵게**, - 목록)</small>
                </span>
                <textarea
                  value={item.licence}
                  maxLength={20000}
                  rows={10}
                  placeholder="구매 직후와 내 주문에서 볼 수 있는 안내문입니다. 저작권, 해도 되는 것과 안 되는 것 같은 내용을 적으세요."
                  onChange={(event) => patch(item.id, { licence: event.target.value })}
                />
                <span className="licence-tools">
                  <small>{item.licence.length.toLocaleString("ko-KR")}/20,000자</small>
                  {item.licence.trim().length === 0 && (
                    <button
                      type="button"
                      className="plain-upload-button"
                      onClick={() => patch(item.id, { licence: LICENCE_TEMPLATE })}
                    >기본 문구 넣기</button>
                  )}
                </span>
              </label>
            </div>

            <div className="store-shot-admin">
              <SortableImages
                images={item.images.map((image) => ({
                  id: image.id,
                  url: `/api/store-images/${image.id}`,
                  alt: image.filename,
                }))}
                onReorder={(order) => reorderShots(item, order)}
                onRemove={(imageId) => removeShot(item, imageId)}
                busy={busy}
              >
                {item.images.length < MAX_ITEM_IMAGES && (
                  <label className="sortable-add">
                    <input type="file" accept="image/*" multiple onChange={(event) => uploadShots(item, event)} disabled={busy}/>
                    <span>＋ 사진</span>
                  </label>
                )}
              </SortableImages>
              <small className="field-help">
                끌어서 순서를 바꿉니다. 맨 앞 칸에 놓은 사진이 목록 카드에 나옵니다. 최대 {MAX_ITEM_IMAGES}장.
              </small>
            </div>

            <div className="plan-list">
              <p className="plan-head">기간과 가격</p>
              {item.plans.map((plan, index) => (
                <div className="plan-row" key={index}>
                  <label className="plan-when">
                    <span>기간</span>
                    <input value={plan.label} maxLength={20} placeholder="1일" onChange={(event) => setPlan(item, index, { label: event.target.value })}/>
                  </label>
                  <label className="plan-money">
                    <span>정가</span>
                    <input type="number" min={0} step={10000} value={plan.price} onChange={(event) => setPlan(item, index, { price: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })}/>
                    {/* Six zeros in a number box are hard to read back, so the
                        grouped figure is printed under it. */}
                    <em>{won(plan.price)}</em>
                  </label>
                  <label className="plan-money">
                    <span>할인가</span>
                    <input type="number" min={0} step={10000} value={plan.salePrice} onChange={(event) => setPlan(item, index, { salePrice: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })}/>
                    <em>{plan.salePrice > 0 ? won(plan.salePrice) : "할인 없음"}</em>
                  </label>

                  {/* Each band gets its own colour, so a small saving and a big
                      one do not have to shout in the same voice. Removing the
                      band sits at the far end of the same line, away from the
                      fields it would undo. */}
                  <div className="plan-colour">
                    <span>
                      {isOnSale(plan)
                        ? (
                          <b
                            className="store-sale-badge"
                            style={{ "--sale": plan.colour, "--on-sale": readableOn(plan.colour) } as CSSProperties}
                          >
                            {discountPercent(plan)}% 할인
                          </b>
                        )
                        : <i>할인가를 넣으면 배지가 보입니다</i>}
                    </span>
                    <div className="sale-colour-picks">
                      {SALE_COLOURS.map((colour) => (
                        <button
                          type="button"
                          key={colour.hex}
                          className={plan.colour === colour.hex ? "on" : ""}
                          style={{ background: colour.hex }}
                          title={colour.name}
                          aria-label={`${plan.label || `${index + 1}번째 기간`} 할인 색: ${colour.name}`}
                          aria-pressed={plan.colour === colour.hex}
                          onClick={() => setPlan(item, index, { colour: colour.hex })}
                        />
                      ))}
                      <input
                        type="color"
                        value={plan.colour}
                        onChange={(event) => setPlan(item, index, { colour: event.target.value.toUpperCase() })}
                        aria-label="직접 고르기"
                      />
                    </div>

                    <button
                      type="button"
                      className="plan-drop"
                      onClick={() => patch(item.id, { plans: item.plans.filter((_, at) => at !== index) })}
                      aria-label={`${plan.label || `${index + 1}번째 기간`} 빼기`}
                    >빼기</button>
                  </div>
                </div>
              ))}
              {item.plans.length === 0 && <p className="field-help">기간이 없으면 상점에 나오지 않습니다.</p>}
              {item.plans.length < MAX_PLANS && (
                <button
                  type="button"
                  className="plan-add"
                  onClick={() => patch(item.id, {
                    plans: [...item.plans, { label: "", price: 0, salePrice: 0, colour: DEFAULT_SALE_COLOUR }],
                  })}
                >＋ 기간 추가</button>
              )}
            </div>

            <div className="slot-admin">
              <label className="switch-row">
                <input type="checkbox" checked={item.slotOn} onChange={(event) => patch(item.id, { slotOn: event.target.checked })}/>
                <span>자리 제한 쓰기</span>
              </label>
              {item.slotOn && (
                <>
                  <div className="slot-numbers">
                    <label>
                      <span>최대 자리</span>
                      <input type="number" min={0} max={9999} value={item.slotMax}
                        onChange={(event) => patch(item.id, { slotMax: Math.max(0, Math.min(9999, Math.trunc(Number(event.target.value) || 0))) })}/>
                    </label>
                    <label>
                      <span>수동으로 채운 자리</span>
                      <input type="number" min={0} max={9999} value={item.slotManual}
                        onChange={(event) => patch(item.id, { slotManual: Math.max(0, Math.min(9999, Math.trunc(Number(event.target.value) || 0))) })}/>
                      <em>라이선스 서버 밖에서 나간 몫</em>
                    </label>
                  </div>
                  <label className="slot-exempt">
                    <span>자리를 차지하지 않는 키 <small>한 줄에 하나. 닉네임(KEY) 형태로 붙여넣어도 됩니다</small></span>
                    <textarea
                      value={item.exemptKeys}
                      maxLength={4000}
                      rows={4}
                      placeholder={"west_cat(PA9GX7Z8D5GG3T)\nChoHa_(PAD6NNS5Z22458)"}
                      onChange={(event) => patch(item.id, { exemptKeys: event.target.value })}
                    />
                    <em>
                      라이선스 서버는 코드를 앞 6자만 남기고 가려서 주므로, 여기 적은 키도
                      같은 방식으로 가려서 맞춥니다. 전체 키를 그대로 적으면 됩니다.
                    </em>
                  </label>
                </>
              )}
            </div>

            <div className="store-admin-foot">
              <label className="switch-row">
                <input type="checkbox" checked={item.active} onChange={(event) => patch(item.id, { active: event.target.checked })}/>
                <span>판매 중</span>
              </label>
              <label className="item-order">
                <span>표시 순서</span>
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
