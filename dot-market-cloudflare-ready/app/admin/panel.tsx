"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { readResult } from "../read-result";
import SortableImages from "../sortable-images";
import { DEADLINE_CHOICES, deadlineLabel } from "../../db/deadlines";
import { LoyaltyTier, MAX_TIERS } from "../../db/loyalty";
import { MAX_SURCHARGES, SizeSurcharge, surchargeThreshold } from "../../db/size-surcharge";

type Pricing = { tilePrice: number; deadlineMultipliers: Record<string, number> };
/** Colours the save bar: a failure must not read as a success. */
type NoticeKind = "info" | "success" | "error";
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
  acceptChannelId: string | null;
  rejectChannelId: string | null;
  completeChannelId: string | null;
  guildId: string | null;
  loyaltyTiers: LoyaltyTier[];
  sizeSurcharges: SizeSurcharge[];
  sizeSurchargeOn: boolean;
  slotMax: number;
  slotManual: number;
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
  /** The in-game account. Null on orders taken before the form asked for it. */
  playerName: string | null;
  status: OrderStatus;
  webhookSent: boolean;
  createdAt: string;
  updatedAt: string;
};

// A handler that throws before it writes a body leaves an empty 500 behind, and
// response.json() then fails with a parse error that hides the real cause. Read
// the body as text first and report what actually came back.

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
  const [messageKind, setMessageKind] = useState<NoticeKind>("info");
  const say = useCallback((text: string, kind: NoticeKind = "info") => {
    setMessage(text); setMessageKind(kind);
  }, []);
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

  /** After a save: server state is the truth, and the form is clean again. */
  const replaceShop = (next: ManagedShop) => {
    setShops((current) => current.map((shop) => shop.id === next.id ? next : shop));
    setDraft(next);
  };

  /**
   * After an image action, take only what the image action changed.
   *
   * Uploading or deleting an image used to overwrite the whole draft with the
   * server's copy, silently throwing away whatever the manager had typed into
   * the name or description fields but not yet saved.
   */
  const applyImageResult = (next: ManagedShop) => {
    const patch = { images: next.images };
    setShops((current) => current.map((shop) => shop.id === next.id ? { ...shop, ...patch } : shop));
    setDraft((current) => current && current.id === next.id ? { ...current, ...patch } : current);
  };

  const chooseShop = (id: string) => {
    const next = shops.find((shop) => shop.id === id) ?? null;
    setSelectedId(id);
    setDraft(next);
    setChannelId("");
    setRemoveChannel(false);
    say("");
  };

  /**
   * What the form can change, as one comparable value. `selected` is the server
   * copy and `draft` is what is on screen, so any difference is unsaved work.
   * Image and slot actions write to both at once and so never look dirty.
   */
  const fingerprint = (shop: ManagedShop | null) => shop && JSON.stringify([
    shop.name, shop.description, shop.aboutTitle, shop.aboutText,
    shop.pricing.tilePrice, shop.pricing.deadlineMultipliers,
    shop.loyaltyTiers, shop.sizeSurcharges, shop.sizeSurchargeOn,
    shop.acceptChannelId, shop.rejectChannelId, shop.completeChannelId,
    shop.slotMax, shop.slotManual,
  ]);
  const dirty = Boolean(draft) && (
    fingerprint(draft) !== fingerprint(selected) || Boolean(channelId) || removeChannel
  );

  // Closing the tab mid-edit is the one case an in-page notice cannot reach.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); say("");
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
          loyaltyTiers: draft.loyaltyTiers,
          sizeSurcharges: draft.sizeSurcharges,
          sizeSurchargeOn: draft.sizeSurchargeOn,
          slotMax: draft.slotMax,
          slotManual: draft.slotManual,
          channelId,
          removeChannel,
          acceptChannelId: draft.acceptChannelId,
          rejectChannelId: draft.rejectChannelId,
          completeChannelId: draft.completeChannelId,
        }),
      });
      const result = await readResult(response, "저장하지 못했습니다.");
      replaceShop(result.shop as ManagedShop);
      setChannelId(""); setRemoveChannel(false);
      say("변경사항을 저장했습니다.", "success");
    } catch (error) {
      say(error instanceof Error ? error.message : "저장하지 못했습니다.", "error");
    } finally { setBusy(false); }
  };

  /**
   * Fills or frees a slot straight from the order list. Saves on click rather
   * than waiting for the settings form, since this is a one-number change a
   * manager makes while working.
   */
  const bumpManual = async (delta: number) => {
    if (!draft) return;
    const next = Math.max(0, Math.min(999, draft.slotManual + delta));
    if (next === draft.slotManual) return;
    setDraft({ ...draft, slotManual: next });
    setShops((current) => current.map((shop) => shop.id === draft.id ? { ...shop, slotManual: next } : shop));
    const response = await fetch(`/api/admin/shops/${draft.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotManual: next }),
    }).catch(() => null);
    if (!response?.ok) say("슬롯을 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.", "error");
  };

  const uploadImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const selectedFiles = Array.from(input.files ?? []);
    if (!draft || selectedFiles.length === 0) return;
    const form = new FormData();
    selectedFiles.forEach((file) => form.append("images", file));
    setImageBusy(true); say("");
    try {
      const response = await fetch(`/api/admin/shops/${draft.id}/images`, { method: "POST", body: form });
      const result = await readResult(response, "이미지를 올리지 못했습니다.");
      applyImageResult(result.shop as ManagedShop);
      say("작업 이미지를 추가했습니다.", "success");
    } catch (error) {
      say(error instanceof Error ? error.message : "이미지를 올리지 못했습니다.", "error");
    } finally {
      setImageBusy(false);
      input.value = "";
    }
  };

  const deleteImage = async (imageId: string) => {
    if (!draft) return;
    setImageBusy(true); say("");
    try {
      const response = await fetch(`/api/admin/shops/${draft.id}/images/${imageId}`, { method: "DELETE" });
      const result = await readResult(response, "이미지를 삭제하지 못했습니다.");
      applyImageResult(result.shop as ManagedShop);
      say("작업 이미지를 삭제했습니다.", "success");
    } catch (error) {
      say(error instanceof Error ? error.message : "이미지를 삭제하지 못했습니다.", "error");
    } finally { setImageBusy(false); }
  };

  const reorderImages = async (order: string[]) => {
    if (!draft) return;
    setImageBusy(true); say("");
    try {
      const response = await fetch(`/api/admin/shops/${draft.id}/images`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const result = await readResult(response, "순서를 바꾸지 못했습니다.");
      applyImageResult(result.shop as ManagedShop);
      say("순서를 저장했습니다. 맨 앞 이미지가 마켓 카드와 샵 소개 첫 화면에 나옵니다.", "success");
    } catch (error) {
      say(error instanceof Error ? error.message : "순서를 바꾸지 못했습니다.", "error");
    } finally { setImageBusy(false); }
  };

  const purgeOrder = async (id: string) => {
    const typed = window.prompt(
      `주문 ${id}을(를) 완전히 삭제합니다.
`
      + `후기와 저장된 그림 파일까지 함께 지워지고 되돌릴 수 없습니다.

`
      + `그래도 지우려면 주문번호를 입력하세요: ${id}`,
    );
    if (typed === null) return;
    if (typed.trim() !== id) { say("입력한 주문번호가 달라서 지우지 않았습니다.", "error"); return; }
    setOrderBusy(id); say("");
    try {
      const response = await fetch(`/api/control/orders/${encodeURIComponent(id)}?confirm=${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = await readResult(response, "주문을 지우지 못했습니다.");
      setOrders((current) => current.filter((order) => order.id !== id));
      say(`${id} 삭제됨 · 파일 ${result.filesPurged}/${result.filesTotal}개 정리`, "success");
    } catch (error) {
      say(error instanceof Error ? error.message : "주문을 지우지 못했습니다.", "error");
    } finally { setOrderBusy(""); }
  };

  const changeOrderStatus = async (id: string, status: Exclude<OrderStatus, "notification_failed">) => {
    setOrderBusy(id); say("");
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = await readResult(response, "주문 상태를 변경하지 못했습니다.");
      setOrders((current) => current.map((order) => order.id === id ? result.order as ManagedOrder : order));
      say(`${id} 상태를 ${STATUS_LABELS[status]}로 변경했습니다.`, "success");
    } catch (error) {
      say(error instanceof Error ? error.message : "주문 상태를 변경하지 못했습니다.", "error");
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

              {(() => {
                // Same statuses countActiveOrders uses, so the meter matches the gate.
                const auto = visibleOrders.filter((order) =>
                  order.status === "new" || order.status === "working" || order.status === "notification_failed").length;
                const used = auto + draft.slotManual;
                const full = draft.slotMax > 0 && used >= draft.slotMax;
                return (
                  <div className={`slot-meter${full ? " full" : ""}${draft.slotMax === 0 ? " off" : ""}`}>
                    <div className="slot-meter-head">
                      <div>
                        <b>접수 슬롯</b>
                        <span>{draft.slotMax === 0
                          ? "제한을 두지 않았습니다. 샵 설정에서 최대 슬롯을 정하면 가득 찼을 때 주문이 자동으로 막힙니다."
                          : full
                            ? "가득 찼습니다. 지금은 새 주문을 받지 않습니다."
                            : `${draft.slotMax - used}칸 남았습니다.`}</span>
                      </div>
                      {draft.slotMax > 0 && <strong>{used}<i>/{draft.slotMax}</i></strong>}
                    </div>
                    {draft.slotMax > 0 && (
                      <div className="slot-bar" role="img" aria-label={`슬롯 ${used}/${draft.slotMax}`}>
                        {Array.from({ length: draft.slotMax }, (_, index) => (
                          <span key={index} className={index < auto ? "auto" : index < used ? "manual" : ""}/>
                        ))}
                      </div>
                    )}
                    <div className="slot-manual">
                      <span>직접 채운 칸 <b>{draft.slotManual}</b></span>
                      <div>
                        <button type="button" onClick={() => bumpManual(-1)} disabled={draft.slotManual === 0} aria-label="직접 채운 칸 줄이기">−</button>
                        <button type="button" onClick={() => bumpManual(1)} aria-label="직접 채운 칸 늘리기">+</button>
                      </div>
                    </div>
                    <p>진행 중인 주문 {auto}건은 자동으로 세어집니다. 사이트 밖에서 받은 작업은 직접 채워두세요. 마감하거나 취소하면 자동으로 비워집니다.</p>
                  </div>
                );
              })()}

              {visibleOrders.length === 0 ? (
                <div className="order-empty"><b>아직 접수된 주문이 없습니다.</b><span>고객이 주문을 완료하면 그림 파일, 연락처, 금액과 마감 정보가 여기에 표시됩니다.</span></div>
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
                    <div><span>마감</span><b>{deadlineLabel(order.deadline)}</b></div>
                    <div><span>예상 금액</span><b>{order.totalPrice.toLocaleString("ko-KR")}원</b></div>
                  </div>
                  <dl>
                    <div><dt>자르기</dt><dd>{order.cropLabel}</dd></div>
                    <div><dt>원본 파일</dt><dd>{order.originalFilename}{!order.hasOriginal && " · 8MB 초과로 미보관"}</dd></div>
                    <div><dt>요청사항</dt><dd>{order.note || "없음"}</dd></div>
                  </dl>
                  <footer>
                    <span className={order.webhookSent ? "sent" : "failed"}>{order.webhookSent ? "Discord 알림 전송됨" : "Discord 알림 실패"}</span>
                    <div>{order.hasOriginal ? <a href={`/api/admin/orders/${encodeURIComponent(order.id)}/files/original`}>그림 파일 받기</a> : <a href={`/api/admin/orders/${encodeURIComponent(order.id)}/files/preview`}>미리보기만 있음 (예전 주문)</a>}{isSuperAdmin && <button type="button" className="purge-order" onClick={() => purgeOrder(order.id)} disabled={orderBusy === order.id}>주문 삭제</button>}</div>
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
                  <div className="portfolio-manager-head"><div><b>작업 이미지</b><span>끌어서 순서를 바꿉니다. 맨 앞 칸에 놓은 이미지가 마켓 카드와 샵 소개 첫 화면에 나옵니다. 최대 10장.</span></div></div>
                  {draft.images.length > 0
                    ? (
                      <SortableImages
                        images={draft.images.map((image) => ({
                          id: image.id,
                          // Served from the authenticated shop upload API.
                          url: `/api/admin/shops/${draft.id}/images/${image.id}`,
                          alt: "",
                        }))}
                        onReorder={reorderImages}
                        onRemove={deleteImage}
                        busy={imageBusy}
                      >
                        {draft.images.length < 10 && (
                          <label className="sortable-add">
                            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={imageBusy} onChange={uploadImages}/>
                            <span>{imageBusy ? "처리 중…" : "＋ 이미지"}</span>
                          </label>
                        )}
                      </SortableImages>
                    )
                    : (
                      <div className="portfolio-empty">
                        <b>아직 등록된 작업 이미지가 없습니다.</b>
                        <span>완성작이나 작업 예시를 올리면 설명 페이지와 마켓 카드에 표시됩니다.</span>
                        <label className="plain-upload-button">
                          {imageBusy ? "처리 중…" : "이미지 추가"}
                          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={imageBusy} onChange={uploadImages}/>
                        </label>
                      </div>
                    )}
                </div>
              </section>

              <section className="settings-card">
                <div className="settings-section-head"><span>03</span><div><h3>가격과 마감</h3><p>한 장의 기본 가격과, 당일 마감에 붙는 배수를 설정합니다.</p></div></div>
                <label className="price-field">32×32 한 장 기본 가격<span><input type="number" min="100" max="10000000" step="100" value={draft.pricing.tilePrice} onChange={(e) => setDraft({ ...draft, pricing: { ...draft.pricing, tilePrice: Number(e.target.value) } })}/> 원</span></label>
                <div className="admin-multiplier-grid">{DEADLINE_CHOICES.map((choice) => <label key={choice.value}><b>{choice.label}</b><span><input type="number" min="1" max="10" step="0.01" value={draft.pricing.deadlineMultipliers[String(choice.value)]} onChange={(e) => setDraft({ ...draft, pricing: { ...draft.pricing, deadlineMultipliers: { ...draft.pricing.deadlineMultipliers, [String(choice.value)]: Number(e.target.value) } } })}/>배</span><small>5×7 {Math.round(35 * draft.pricing.tilePrice * draft.pricing.deadlineMultipliers[String(choice.value)]).toLocaleString("ko-KR")}원</small></label>)}</div>
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

                <div className="outcome-channels">
                  <p className="field-help">수락·거절·완성을 따로 모으고 싶으면 아래에서 채널을 나눠주세요. 비워두면 전부 위의 알림 채널로 갑니다.</p>
                  {([
                    ["acceptChannelId", "수락한 주문"],
                    ["rejectChannelId", "거절한 주문"],
                    ["completeChannelId", "완성한 주문"],
                  ] as const).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      {channels.length > 0 ? (
                        <select value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value || null })}>
                          <option value="">주문 채널과 같이</option>
                          {channels.map((channel) => <option value={channel.id} key={channel.id}>#{channel.name}</option>)}
                        </select>
                      ) : (
                        <input inputMode="numeric" autoComplete="off" value={draft[key] ?? ""} placeholder="주문 채널과 같이" onChange={(e) => setDraft({ ...draft, [key]: e.target.value || null })}/>
                      )}
                    </label>
                  ))}
                </div>
              </section>

              <section className="settings-card">
                <div className="settings-section-head"><span>05</span><div><h3>큰 그림 추가금</h3><p>정해둔 크기를 넘는 그림에 장당 추가금을 받습니다. 주문 화면 금액 내역과 샵 소개에 그대로 표시됩니다.</p></div><i className={draft.sizeSurchargeOn ? "connected" : "not-connected"}>{draft.sizeSurchargeOn ? "받는 중" : "안 받음"}</i></div>
                <label className="switch-row"><input type="checkbox" checked={draft.sizeSurchargeOn} onChange={(e) => setDraft({ ...draft, sizeSurchargeOn: e.target.checked })}/><span>큰 그림 추가금 받기</span></label>
                {draft.sizeSurchargeOn && (
                  <div className="tier-list">
                    {draft.sizeSurcharges.map((band, index) => (
                      <div className="tier-row" key={index}>
                        <label><input type="number" min={1} max={100} value={band.size} onChange={(e) => {
                          const next = [...draft.sizeSurcharges];
                          next[index] = { ...band, size: Math.max(1, Math.min(100, Math.trunc(Number(e.target.value) || 1))) };
                          setDraft({ ...draft, sizeSurcharges: next });
                        }}/>×{band.size} 초과</label>
                        <label>이름<input maxLength={20} value={band.label} placeholder="예: 대형" onChange={(e) => {
                          const next = [...draft.sizeSurcharges];
                          next[index] = { ...band, label: e.target.value };
                          setDraft({ ...draft, sizeSurcharges: next });
                        }}/></label>
                        <label>장당<input type="number" min={0} max={10000000} step={100} value={band.perTile} onChange={(e) => {
                          const next = [...draft.sizeSurcharges];
                          next[index] = { ...band, perTile: Math.max(0, Math.min(10000000, Math.trunc(Number(e.target.value) || 0))) };
                          setDraft({ ...draft, sizeSurcharges: next });
                        }}/>원</label>
                        <small>{surchargeThreshold(band).toLocaleString("ko-KR")}장 초과부터</small>
                        <button type="button" onClick={() => setDraft({ ...draft, sizeSurcharges: draft.sizeSurcharges.filter((_, at) => at !== index) })}>빼기</button>
                      </div>
                    ))}
                    {draft.sizeSurcharges.length === 0 && <p className="field-help">단계를 하나도 두지 않으면 추가금이 붙지 않습니다.</p>}
                    {draft.sizeSurcharges.length < MAX_SURCHARGES && (
                      <button type="button" className="plain-upload-button" onClick={() => setDraft({
                        ...draft,
                        sizeSurcharges: [...draft.sizeSurcharges, {
                          size: (draft.sizeSurcharges.at(-1)?.size ?? 4) + 5,
                          label: "",
                          perTile: 0,
                        }],
                      })}>단계 추가</button>
                    )}
                    <p className="field-help">해당하는 단계 중 가장 큰 것 하나만 붙습니다. 겹치지 않습니다. 저장할 때 크기 순으로 정리되고, 이름이 비었거나 크기가 겹치는 줄은 빠집니다. 최대 {MAX_SURCHARGES}단계.</p>
                  </div>
                )}
              </section>

              <section className="settings-card">
                <div className="settings-section-head"><span>06</span><div><h3>단골 칭호</h3><p>같은 손님이 여러 번 주문하면 후기 옆에 붙는 이름입니다. 후기에는 몇 번째 주문인지도 함께 표시됩니다.</p></div></div>
                <div className="tier-list">
                  {draft.loyaltyTiers.map((tier, index) => (
                    <div className="tier-row" key={index}>
                      <label>주문<input type="number" min={2} max={9999} value={tier.count} onChange={(e) => {
                        const next = [...draft.loyaltyTiers];
                        next[index] = { ...tier, count: Math.max(2, Math.min(9999, Math.trunc(Number(e.target.value) || 2))) };
                        setDraft({ ...draft, loyaltyTiers: next });
                      }}/>회 이상</label>
                      <label>칭호<input maxLength={20} value={tier.label} placeholder="예: 열혈팬" onChange={(e) => {
                        const next = [...draft.loyaltyTiers];
                        next[index] = { ...tier, label: e.target.value };
                        setDraft({ ...draft, loyaltyTiers: next });
                      }}/></label>
                      <button type="button" onClick={() => setDraft({ ...draft, loyaltyTiers: draft.loyaltyTiers.filter((_, at) => at !== index) })}>빼기</button>
                    </div>
                  ))}
                  {draft.loyaltyTiers.length === 0 && <p className="field-help">칭호를 하나도 두지 않으면 후기에는 몇 번째 주문인지만 표시됩니다.</p>}
                  {draft.loyaltyTiers.length < MAX_TIERS && (
                    <button type="button" className="plain-upload-button" onClick={() => setDraft({
                      ...draft,
                      loyaltyTiers: [...draft.loyaltyTiers, {
                        count: (draft.loyaltyTiers.at(-1)?.count ?? 1) + 2,
                        label: "",
                      }],
                    })}>칭호 추가</button>
                  )}
                  <p className="field-help">저장할 때 주문 횟수 순으로 정리되고, 이름이 비었거나 횟수가 겹치는 줄은 빠집니다. 최대 {MAX_TIERS}개.</p>
                </div>
              </section>

              <section className="settings-card">
                <div className="settings-section-head"><span>07</span><div><h3>접수 슬롯</h3><p>한 번에 몇 건까지 받을지 정합니다. 가득 차면 주문 화면에서 접수 버튼이 잠깁니다.</p></div></div>
                <div className="field-grid">
                  <label>최대 슬롯<input type="number" min={0} max={999} value={draft.slotMax} onChange={(e) => setDraft({ ...draft, slotMax: Math.max(0, Math.min(999, Math.trunc(Number(e.target.value) || 0))) })}/><small>0으로 두면 제한 없이 계속 받습니다.</small></label>
                  <label>직접 채운 칸<input type="number" min={0} max={999} value={draft.slotManual} onChange={(e) => setDraft({ ...draft, slotManual: Math.max(0, Math.min(999, Math.trunc(Number(e.target.value) || 0))) })}/><small>사이트 밖에서 받은 작업 수. 주문 기록 화면에서도 바로 조절할 수 있습니다.</small></label>
                </div>
              </section>

              <div className={`save-bar${dirty ? " dirty" : ""}`}>
                {/* Editing again after a save must not keep reading "저장했습니다".
                    An unsaved change outranks any older notice; only a failure,
                    which the manager still has to deal with, outranks that. */}
                <span className={`save-state ${messageKind === "error" ? "error" : dirty ? "dirty" : message ? messageKind : "clean"}`}>
                  {messageKind === "error"
                    ? message
                    : dirty
                      ? "저장하지 않은 변경사항이 있습니다."
                      : message || "모든 변경사항이 저장되었습니다."}
                </span>
                <button disabled={busy || imageBusy || !dirty}>
                  {busy ? "저장 중…" : dirty ? "변경사항 저장" : "저장됨"}
                </button>
              </div>
            </form>
          )}
        </section>
      </section>
    </main>
  );
}
