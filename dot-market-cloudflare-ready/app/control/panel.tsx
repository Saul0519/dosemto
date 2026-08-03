"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type Shop = { id: string; slug: string; name: string; description: string; managerEmail: string; active: boolean; webhookConfigured: boolean };
type ModeratedReview = {
  id: string; orderId: string; rating: number; body: string;
  displayName: string; createdAt: string; shopName: string; hidden: boolean;
};

export default function ControlPanel({ initialShops, initialReviews }: {
  initialShops: Shop[];
  initialReviews: ModeratedReview[];
}) {
  const [shops, setShops] = useState(initialShops);
  const [reviews, setReviews] = useState(initialReviews);
  const [drafts, setDrafts] = useState<Record<string, { managerEmail: string; active: boolean }>>(() => Object.fromEntries(initialShops.map((shop) => [shop.id, { managerEmail: shop.managerEmail, active: shop.active }])));
  const [form, setForm] = useState({ name: "", slug: "", managerEmail: "", description: "" });
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const say = (text: string, kind: "success" | "error" = "success") => {
    setMessage(text); setMessageKind(kind);
  };
  const [busy, setBusy] = useState(false);

  /** A card is dirty while its two editable fields differ from the server copy. */
  const isDirty = (shop: Shop) => {
    const draft = drafts[shop.id];
    return Boolean(draft) && (draft.managerEmail !== shop.managerEmail || draft.active !== shop.active);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); say("");
    try {
      const response = await fetch("/api/control/shops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setShops((current) => [...current, result.shop]);
      setDrafts((current) => ({ ...current, [result.shop.id]: { managerEmail: result.shop.managerEmail, active: result.shop.active } }));
      setForm({ name: "", slug: "", managerEmail: "", description: "" }); say("새 샵을 만들고 관리자를 지정했습니다.");
    } catch (error) { say(error instanceof Error ? error.message : "샵을 만들지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  const update = async (shop: Shop) => {
    const draft = drafts[shop.id]; if (!draft) return; setBusy(true); say("");
    try {
      const response = await fetch(`/api/control/shops/${shop.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setShops((current) => current.map((item) => item.id === shop.id ? { ...item, ...result.shop } : item)); say(`${shop.name}의 관리자와 공개 상태를 저장했습니다.`);
    } catch (error) { say(error instanceof Error ? error.message : "변경하지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  const remove = async (shop: Shop) => {
    const typed = window.prompt(
      `"${shop.name}"을(를) 삭제합니다.\n\n`
      + `이 샵의 주문 기록과 손님들이 남긴 후기, 저장된 도안·원본 파일까지 함께 지워지고, 되돌릴 수 없습니다.\n`
      + `잠시 내리는 것이라면 아래 "마켓과 주문 화면에 공개"를 끄는 쪽을 쓰세요.\n\n`
      + `그래도 삭제하려면 샵 주소를 그대로 입력하세요: ${shop.slug}`,
    );
    if (typed === null) return;
    if (typed.trim() !== shop.slug) { say("입력한 주소가 달라서 삭제하지 않았습니다.", "error"); return; }

    setBusy(true); say("");
    try {
      const response = await fetch(`/api/control/shops/${shop.id}?confirm=${encodeURIComponent(shop.slug)}`, { method: "DELETE" });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || `삭제하지 못했습니다. (서버 응답 ${response.status})`);
      setShops((current) => current.filter((item) => item.id !== shop.id));
      setDrafts((current) => { const next = { ...current }; delete next[shop.id]; return next; });
      const r = result.removed;
      say(`${r.name} 삭제됨 · 주문 ${r.orderCount}건 · 후기 ${r.reviewCount}건 · 이미지 ${r.imageCount}장 · 파일 ${r.filesPurged}/${r.filesTotal}개 정리`);
    } catch (error) { say(error instanceof Error ? error.message : "삭제하지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  const toggleReview = async (review: ModeratedReview) => {
    setBusy(true); say("");
    try {
      const response = await fetch(`/api/control/reviews/${encodeURIComponent(review.orderId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hidden: !review.hidden }),
      });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || "처리하지 못했습니다.");
      setReviews((current) => current.map((item) =>
        item.orderId === review.orderId ? { ...item, hidden: !review.hidden } : item));
      say(review.hidden ? "후기를 다시 보이게 했습니다." : "후기를 숨겼습니다. 샵 페이지에는 숨긴 개수가 표시됩니다.");
    } catch (error) { say(error instanceof Error ? error.message : "처리하지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  const purge = async (review: ModeratedReview) => {
    const typed = window.prompt(
      `후기를 완전히 삭제합니다. 되돌릴 수 없고 숨긴 개수에도 잡히지 않습니다.
`
      + `평소에는 "숨기기"를 쓰세요. 그래도 지우려면 주문번호를 입력하세요: ${review.orderId}`,
    );
    if (typed === null) return;
    if (typed.trim() !== review.orderId) { say("입력한 주문번호가 달라서 지우지 않았습니다.", "error"); return; }
    setBusy(true); say("");
    try {
      const response = await fetch(`/api/control/reviews/${encodeURIComponent(review.orderId)}`, { method: "DELETE" });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || "지우지 못했습니다.");
      setReviews((current) => current.filter((item) => item.orderId !== review.orderId));
      say(`${review.orderId} 후기를 완전히 삭제했습니다.`);
    } catch (error) { say(error instanceof Error ? error.message : "지우지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  return <main className="control-page"><header><Link href="/admin">← 샵 관리</Link><strong>DOT MARKET CONTROL</strong><Link href="/">마켓 보기</Link></header><section className="control-shell"><div className="control-intro"><p>SUPER ADMIN ONLY</p><h1>입점 샵 컨트롤</h1><span>총괄 관리자만 새 샵을 만들고 담당 관리자를 지정할 수 있습니다.</span></div><form className="create-shop-card" onSubmit={create}><div><h2>새 샵 만들기</h2><p>별도 관리자 비밀번호는 만들지 않습니다. 지정된 이메일로 로그인한 사람만 해당 샵을 관리합니다.</p></div><div className="create-fields"><label>샵 이름<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 루나 도트 공방"/></label><label>샵 주소<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="luna-pixel"/><small>/shop/{form.slug || "luna-pixel"}</small></label><label>샵 관리자 로그인 이메일<input required type="email" value={form.managerEmail} onChange={(e) => setForm({ ...form, managerEmail: e.target.value })} placeholder="manager@example.com"/><small>이 주소로 Cloudflare Access 로그인 코드를 받습니다</small></label><label className="wide">샵 소개<textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label></div><button disabled={busy}>{busy ? "처리 중…" : "샵 생성하기"}</button></form><div className="control-list-head"><h2>전체 샵</h2><span>{shops.length}개</span></div><div className="control-shop-list">{shops.map((shop) => { const draft = drafts[shop.id]; return <article key={shop.id}><div className="control-shop-title"><div><h3>{shop.name}</h3><span>/shop/{shop.slug}</span></div><i className={shop.webhookConfigured ? "ready" : "pending"}>{shop.webhookConfigured ? "웹훅 연결됨" : "웹훅 미연결"}</i></div><label>샵 관리자 로그인 이메일<input type="email" value={draft?.managerEmail ?? ""} onChange={(e) => setDrafts({ ...drafts, [shop.id]: { ...draft, managerEmail: e.target.value } })}/><small>Access에도 이 주소가 허용돼 있어야 로그인됩니다</small></label><label className="switch-row"><input type="checkbox" checked={draft?.active ?? false} onChange={(e) => setDrafts({ ...drafts, [shop.id]: { ...draft, active: e.target.checked } })}/><span>마켓과 주문 화면에 공개</span></label><div className={`control-shop-foot${isDirty(shop) ? " dirty" : ""}`}><Link href={`/shop/${shop.slug}`}>샵 보기 ↗</Link><span className="control-save-state">{isDirty(shop) ? "저장하지 않은 변경사항" : "저장됨"}</span><div className="control-shop-actions"><button type="button" className="danger" onClick={() => remove(shop)} disabled={busy}>샵 삭제</button><button type="button" onClick={() => update(shop)} disabled={busy || !isDirty(shop)}>{isDirty(shop) ? "변경 저장" : "저장됨"}</button></div></div></article>; })}</div><div className="control-list-head"><h2>전체 후기</h2><span>{reviews.length}개 · 숨김 {reviews.filter((r) => r.hidden).length}개</span></div><div className="moderation-list">{reviews.length === 0 ? <p className="field-help">아직 후기가 없습니다.</p> : reviews.map((review) => (<article key={review.id} className={review.hidden ? "hidden-review" : ""}><div className="moderation-head"><b>{"★".repeat(review.rating)}<i>{"★".repeat(5 - review.rating)}</i></b><span>{review.displayName}</span><small>{review.shopName}</small><code>{review.orderId}</code>{review.hidden && <em>숨김</em>}</div>{review.body && <p>{review.body}</p>}<div className="moderation-actions"><button type="button" onClick={() => toggleReview(review)} disabled={busy}>{review.hidden ? "다시 보이기" : "숨기기"}</button><button type="button" className="danger" onClick={() => purge(review)} disabled={busy}>완전 삭제</button></div></article>))}</div>{message && <div className={`control-message ${messageKind}`}>{message}</div>}</section></main>;
}
