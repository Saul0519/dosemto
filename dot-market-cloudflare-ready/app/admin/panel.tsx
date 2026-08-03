"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Pricing = { tilePrice: number; deadlineMultipliers: Record<string, number> };
type ShopImage = { id: string; filename: string; contentType: string; position: number; url: string };
type ManagedShop = {
  id: string;
  slug: string;
  name: string;
  description: string;
  aboutTitle: string;
  aboutText: string;
  images: ShopImage[];
  managerEmail: string;
  pricing: Pricing;
  webhookConfigured: boolean;
  channelId: string | null;
  guildId: string | null;
  active: boolean;
};

type OrderStatus = "new" | "working" | "completed" | "cancelled" | "notification_failed";
type ManagedOrder = {
  id: string;
  shopId: string;
  shopName: string;
  contact: string;
  note: string;
  gridX: number;
  gridY: number;
  tileCount: number;
  deadline: number;
  totalPrice: number;
  cropLabel: string;
  originalFilename: string;
  hasOriginal: boolean;
  status: OrderStatus;
  webhookSent: boolean;
  createdAt: string;
  updatedAt: string;
};

// A handler that throws before it writes a body leaves an empty 500 behind, and
// response.json() then fails with a parse error that hides the real cause. Read
// the body as text first and report what actually came back.
async function readResult(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) {
    throw new Error(
      response.ok
        ? fallback
        : `${fallback} (서버 응답 ${response.status}, 본문 없음 — Worker 로그를 확인해 주세요.)`,
    );
  }
  let parsed: { error?: string; [key: string]: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${fallback} (서버 응답 ${response.status})`);
  }
  if (!response.ok) throw new Error(parsed.error || fallback);
  return parsed;
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  new: "신규 접수",
  working: "작업 중",
  completed: "완료",
  cancelled: "취소",
  notification_failed: "알림 실패",
};

function formatOrderDate(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPanel({ userName, shops: initialShops, orders: initialOrders, isSuperAdmin, signOutPath, inviteResult }: {
  userName: string;
  shops: ManagedShop[];
  orders: ManagedOrder[];
  isSuperAdmin: boolean;
  signOutPath: string;
  /** Outcome of a bot invite the manager just came back from. */
  inviteResult?: string | null;
}) {
  const [shops, setShops] = useState(initialShops);
  const [selectedId, setSelectedId] = useState(initialShops[0]?.id ?? "");
  const selected = useMemo(() => shops.find((shop) => shop.id === selectedId) ?? null, [shops, selectedId]);
  const [draft, setDraft] = useState<ManagedShop | null>(initialShops[0] ?? null);
  const [channelId, setChannelId] = useState("");
  const [removeChannel, setRemoveChannel] = useState(false);
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [needsInvite, setNeedsInvite] = useState(false);
  const [channelsBusy, setChannelsBusy] = useState(false);
  const [message, setMessage] = useState(inviteResult ?? "");
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [orders, setOrders] = useState(initialOrders);
  const [dashboardMode, setDashboardMode] = useState<"orders" | "settings">(inviteResult ? "settings" : "orders");
  const [orderBusy, setOrderBusy] = useState("");
  const visibleOrders = useMemo(() => orders.filter((order) => order.shopId === selectedId), [orders, selectedId]);

  // The list comes from Discord, so it can only be fetched once the bot is in
  // the manager's server. Re-runs whenever the selected shop changes.
  const loadChannels = useCallback(async (shopId: string, showBusy = false) => {
    if (!shopId) return;
    // Only the manual refresh flips the busy flag. Doing it on mount would be a
    // synchronous setState inside the effect, which cascades a render.
    if (showBusy) setChannelsBusy(true);
    try {
      const response = await fetch(`/api/admin/shops/${shopId}/channels`);
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || "채널 목록을 불러오지 못했습니다.");
      setChannels(result.channels ?? []);
      setNeedsInvite(Boolean(result.needsInvite));
    } catch {
      setChannels([]);
      setNeedsInvite(true);
    } finally {
      setChannelsBusy(false);
    }
  }, []);

  // Fetching the channel list on mount is the point of this effect; every
  // setState inside loadChannels happens after the request resolves, which the
  // lint rule cannot see through the async boundary.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadChannels(selectedId); }, [selectedId, loadChannels]);

  const replaceShop = (next: ManagedShop) => {
    setShops((current) => current.map((shop) => shop.id === next.id ? next : shop));
    setDraft(next);
  };

  const chooseShop = (id: string) => {
    const next = shops.find((shop) => shop.id === id) ?? null;
    setSelectedId(id);
    setDraft(next);
    setChannelId("");
    setRemoveChannel(false);
    setMessage("");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/shops/${draft.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          aboutTitle: draft.aboutTitle,
          aboutText: draft.aboutText,
          pricing: draft.pricing,
          channelId,
          removeChannel,
        }),
      });
      const result = await readResult(response, "저장하지 못했습니다.");
      replaceShop(result.shop as ManagedShop);
      setChannelId(""); setRemoveChannel(false);
      setMessage("변경사항을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const uploadImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const selectedFiles = Array.from(input.files ?? []);
    if (!draft || selectedFiles.length === 0) return;
    const form = new FormData();
    selectedFiles.forEach((file) => form.append("images", file));
    setImageBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/shops/${draft.id}/images`, { method: "POST", body: form });
      const result = await readResult(response, "이미지를 올리지 못했습니다.");
      replaceShop(result.shop as ManagedShop);
      setMessage("작업 이미지를 추가했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지를 올리지 못했습니다.");
    } finally {
      setImageBusy(false);
      input.value = "";
    }
  };

  const deleteImage = async (imageId: string) => {
    if (!draft) return;
    setImageBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/shops/${draft.id}/images/${imageId}`, { method: "DELETE" });
      const result = await readResult(response, "이미지를 삭제하지 못했습니다.");
      replaceShop(result.shop as ManagedShop);
      setMessage("작업 이미지를 삭제했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지를 삭제하지 못했습니다.");
    } finally { setImageBusy(false); }
  };

  const purgeOrder = async (id: string) => {
    const typed = window.prompt(
      `주문 ${id}을(를) 완전히 삭제합니다.
`
      + `후기와 저장된 도안·원본 파일까지 함께 지워지고 되돌릴 수 없습니다.

`
      + `그래도 지우려면 주문번호를 입력하세요: ${id}`,
    );
    if (typed === null) return;
    if (typed.trim() !== id) { setMessage("입력한 주문번호가 달라서 지우지 않았습니다."); return; }
    setOrderBusy(id); setMessage("");
    try {
      const response = await fetch(`/api/control/orders/${encodeURIComponent(id)}?confirm=${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = await readResult(response, "주문을 지우지 못했습니다.");
      setOrders((current) => current.filter((order) => order.id !== id));
      setMessage(`${id} 삭제됨 · 파일 ${result.filesPurged}/${result.filesTotal}개 정리`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "주문을 지우지 못했습니다.");
    } finally { setOrderBusy(""); }
  };

  const changeOrderStatus = async (id: string, status: Exclude<OrderStatus, "notification_failed">) => {
    setOrderBusy(id); setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = await readResult(response, "주문 상태를 변경하지 못했습니다.");
      setOrders((current) => current.map((order) => order.id === id ? result.order as ManagedOrder : order));
      setMessage(`${id} 상태를 ${STATUS_LABELS[status]}로 변경했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "주문 상태를 변경하지 못했습니다.");
    } finally { setOrderBusy(""); }
  };

  return (
    <main className="admin-page dashboard-page">
      <header>
        <Link href="/">← 마켓</Link><strong>DOT MARKET</strong>
        <div><span>{isSuperAdmin ? "SUPER ADMIN" : "SHOP MANAGER"}</span><a href={signOutPath}>로그아웃</a></div>
      </header>
      <section className="dashboard-shell">
        <aside className="dashboard-sidebar">
          <p>{userName}님</p><h1>내 샵 관리</h1>
          {isSuperAdmin && <Link className="control-link" href="/control">입점 샵 만들기·관리</Link>}
          <div className="dashboard-mode-tabs" role="tablist" aria-label="관리 화면 선택">
            <button type="button" className={dashboardMode === "orders" ? "active" : ""} onClick={() => setDashboardMode("orders")}><b>주문 기록</b><span>{orders.length}건</span></button>
            <button type="button" className={dashboardMode === "settings" ? "active" : ""} onClick={() => setDashboardMode("settings")}><b>샵 설정</b><span>가격·설명</span></button>
          </div>
          <nav>{shops.map((shop) => (
            <button type="button" key={shop.id} className={selectedId === shop.id ? "active" : ""} onClick={() => chooseShop(shop.id)}>
              <b>{shop.name}</b><span>/{shop.slug} · {shop.active ? "공개" : "비공개"}</span>
            </button>
          ))}</nav>
        </aside>

        <section className="dashboard-content">
          {!selected || !draft ? <div className="empty-admin"><h2>관리할 샵이 없습니다.</h2><p>총괄 관리자에게 샵 생성과 관리자 지정을 요청하세요.</p></div> : dashboardMode === "orders" ? (
            <section className="order-archive">
              <div className="settings-title order-archive-title">
                <div><p>ORDER ARCHIVE</p><h2>{selected.name} 주문 기록</h2><span>최근 주문 최대 250건을 안전하게 보관합니다.</span></div>
                <Link href={`/shop/${selected.slug}`}>주문 화면 보기 ↗</Link>
              </div>

              <div className="order-stat-grid">
                <div><span>전체</span><b>{visibleOrders.length}</b></div>
                <div><span>신규</span><b>{visibleOrders.filter((order) => order.status === "new").length}</b></div>
                <div><span>작업 중</span><b>{visibleOrders.filter((order) => order.status === "working").length}</b></div>
                <div><span>완료</span><b>{visibleOrders.filter((order) => order.status === "completed").length}</b></div>
              </div>

              {visibleOrders.length === 0 ? (
                <div className="order-empty"><b>아직 접수된 주문이 없습니다.</b><span>고객이 주문을 완료하면 도안, 연락처, 금액과 마감 정보가 여기에 표시됩니다.</span></div>
              ) : <div className="order-history-list">{visibleOrders.map((order) => (
                <article className={`order-history-card status-${order.status}`} key={order.id}>
                  <header>
                    <div><span>{formatOrderDate(order.createdAt)}</span><h3>{order.id}</h3><small>{order.shopName}</small></div>
                    <label>진행 상태
                      <select value={order.status} disabled={orderBusy === order.id} onChange={(event) => changeOrderStatus(order.id, event.target.value as Exclude<OrderStatus, "notification_failed">)}>
                        {order.status === "notification_failed" && <option value="notification_failed">알림 실패</option>}
                        <option value="new">신규 접수</option><option value="working">작업 중</option><option value="completed">완료</option><option value="cancelled">취소</option>
                      </select>
                    </label>
                  </header>
                  <div className="order-facts">
                    <div><span>연락처</span><b>{order.contact}</b></div>
                    <div><span>그림 크기</span><b>{order.gridX} × {order.gridY} · {order.tileCount}장</b></div>
                    <div><span>마감</span><b>{order.deadline}일</b></div>
                    <div><span>예상 금액</span><b>{order.totalPrice.toLocaleString("ko-KR")}원</b></div>
                  </div>
                  <dl>
                    <div><dt>자르기</dt><dd>{order.cropLabel}</dd></div>
                    <div><dt>원본 파일</dt><dd>{order.originalFilename}{!order.hasOriginal && " · 8MB 초과로 미보관"}</dd></div>
                    <div><dt>요청사항</dt><dd>{order.note || "없음"}</dd></div>
                  </dl>
                  <footer>
                    <span className={order.webhookSent ? "sent" : "failed"}>{order.webhookSent ? "Discord 알림 전송됨" : "Discord 알림 실패"}</span>
                    <div><a href={`/api/admin/orders/${encodeURIComponent(order.id)}/files/preview`}>변환 도안 받기</a>{order.hasOriginal && <a href={`/api/admin/orders/${encodeURIComponent(order.id)}/files/original`}>원본 받기</a>}{isSuperAdmin && <button type="button" className="purge-order" onClick={() => purgeOrder(order.id)} disabled={orderBusy === order.id}>주문 삭제</button>}</div>
                  </footer>
                </article>
              ))}</div>}
              {message && <p className="order-archive-message">{message}</p>}
            </section>
          ) : (
            <form className="shop-settings" onSubmit={save}>
              <div className="settings-title">
                <div><p>SHOP SETTINGS</p><h2>{selected.name}</h2><span>/shop/{selected.slug}</span></div>
                <div className="settings-preview-links"><Link href={`/shop/${selected.slug}/about`}>샵 소개 보기 ↗</Link><Link href={`/shop/${selected.slug}`}>주문 화면 보기 ↗</Link></div>
              </div>

              <section className="settings-card">
                <div className="settings-section-head"><span>01</span><div><h3>기본 정보</h3><p>마켓 목록과 주문 화면에 표시되는 짧은 정보입니다.</p></div></div>
                <div className="field-grid">
                  <label>샵 이름<input maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label>
                  <label className="wide">짧은 소개<textarea maxLength={300} rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}/><small>{draft.description.length}/300자</small></label>
                </div>
              </section>

              <section className="settings-card service-editor-card">
                <div className="settings-section-head"><span>02</span><div><h3>샵 소개 페이지</h3><p>작업 스타일, 신청 전 확인사항, 진행 과정 등을 자유롭게 적어주세요.</p></div></div>
                <div className="service-copy-fields">
                  <label>상세 페이지 제목<input maxLength={100} value={draft.aboutTitle} onChange={(e) => setDraft({ ...draft, aboutTitle: e.target.value })} placeholder="예: 도트 감성을 살린 맞춤 픽셀 작품"/></label>
                  <label>상세 설명<textarea maxLength={12000} rows={16} value={draft.aboutText} onChange={(e) => setDraft({ ...draft, aboutText: e.target.value })} placeholder={"작업에 대해 자유롭게 설명해 주세요.\n\n예시\n• 어떤 스타일로 작업하는지\n• 신청 전에 준비할 것\n• 수정 가능 범위\n• 작업 진행 순서"}/><small>엔터 한 번은 줄바꿈, 두 번은 문단 나누기로 표시됩니다. {draft.aboutText.length.toLocaleString("ko-KR")}/12,000자</small></label>
                </div>
                <div className="portfolio-manager">
                  <div className="portfolio-manager-head"><div><b>작업 이미지</b><span>첫 번째 이미지가 대표 이미지로 표시됩니다. 최대 10장.</span></div><label className="plain-upload-button">{imageBusy ? "처리 중…" : "이미지 추가"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={imageBusy || draft.images.length >= 10} onChange={uploadImages}/></label></div>
                  {draft.images.length > 0 ? <div className="portfolio-admin-grid">{draft.images.map((image, index) => (
                    <figure key={image.id}>
                      {/* Images are served from the authenticated shop upload API. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/admin/shops/${draft.id}/images/${image.id}`} alt=""/>
                      <figcaption><span>{index === 0 ? "대표" : `${index + 1}`}</span><button type="button" disabled={imageBusy} onClick={() => deleteImage(image.id)}>삭제</button></figcaption>
                    </figure>
                  ))}</div> : <div className="portfolio-empty"><b>아직 등록된 작업 이미지가 없습니다.</b><span>완성작이나 작업 예시를 올리면 설명 페이지와 마켓 카드에 표시됩니다.</span></div>}
                </div>
              </section>

              <section className="settings-card">
                <div className="settings-section-head"><span>03</span><div><h3>가격과 마감</h3><p>한 장의 기본 가격과 일정별 배수를 설정합니다.</p></div></div>
                <label className="price-field">32×32 한 장 기본 가격<span><input type="number" min="100" max="1000000" step="100" value={draft.pricing.tilePrice} onChange={(e) => setDraft({ ...draft, pricing: { ...draft.pricing, tilePrice: Number(e.target.value) } })}/> 원</span></label>
                <div className="admin-multiplier-grid">{[1,2,3,4,5,6,7].map((day) => <label key={day}><b>{day}일</b><span><input type="number" min="1" max="10" step="0.01" value={draft.pricing.deadlineMultipliers[String(day)]} onChange={(e) => setDraft({ ...draft, pricing: { ...draft.pricing, deadlineMultipliers: { ...draft.pricing.deadlineMultipliers, [String(day)]: Number(e.target.value) } } })}/>배</span><small>5×7 {Math.round(35 * draft.pricing.tilePrice * draft.pricing.deadlineMultipliers[String(day)]).toLocaleString("ko-KR")}원</small></label>)}</div>
              </section>

              <section className="settings-card">
                <div className="settings-section-head"><span>04</span><div><h3>디스코드 주문 알림</h3><p>새 주문 알림을 받을 채널의 ID를 입력합니다. 봇이 그 채널에 글을 쓸 수 있어야 합니다.</p></div><i className={draft.webhookConfigured ? "connected" : "not-connected"}>{draft.webhookConfigured ? "연결됨" : "연결 필요"}</i></div>
                <p className="field-help">봇을 서버에 초대하면 아래에서 채널을 고를 수 있습니다. 봇은 글을 쓰기만 하고 대화 내용은 읽지 않습니다.</p>
                <p className="invite-row">
                  <a className="plain-upload-button" href={`/api/admin/invite?shop=${draft.id}`}>
                    {draft.guildId ? "다른 서버로 다시 초대" : "봇 초대하기"}
                  </a>
                  {draft.guildId && <button type="button" className="plain-upload-button" onClick={() => void loadChannels(draft.id, true)} disabled={channelsBusy}>{channelsBusy ? "불러오는 중…" : "채널 목록 새로고침"}</button>}
                </p>
                {channels.length > 0 ? (
                  <label>알림 채널
                    <select value={channelId || draft.channelId || ""} onChange={(e) => { setChannelId(e.target.value); setRemoveChannel(false); }}>
                      <option value="">고르지 않음</option>
                      {channels.map((channel) => <option value={channel.id} key={channel.id}>#{channel.name}</option>)}
                    </select>
                    <small>{draft.channelId ? "지금 저장된 채널이 선택돼 있습니다." : "새 주문 알림이 올라갈 채널을 고르세요."}</small>
                  </label>
                ) : (
                  <label>알림 채널 ID<input inputMode="numeric" autoComplete="off" value={channelId} onChange={(e) => { setChannelId(e.target.value); setRemoveChannel(false); }} placeholder={draft.channelId ?? "봇을 초대하면 목록에서 고를 수 있습니다"}/><small>{needsInvite ? "봇이 아직 서버에 없습니다. 위의 초대 버튼을 눌러주세요. 직접 채널 ID를 붙여넣어도 됩니다." : "채널 목록을 불러오는 중입니다."}</small></label>
                )}
                {draft.webhookConfigured && <label className="check-row"><input type="checkbox" checked={removeChannel} onChange={(e) => { setRemoveChannel(e.target.checked); if (e.target.checked) setChannelId(""); }}/><span>알림 채널 연결 해제 (주문 접수 중단)</span></label>}
              </section>

              <div className="save-bar"><span>{message}</span><button disabled={busy || imageBusy}>{busy ? "저장 중…" : "변경사항 저장"}</button></div>
            </form>
          )}
        </section>
      </section>
    </main>
  );
}
