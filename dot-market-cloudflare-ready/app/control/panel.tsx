"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type Shop = { id: string; slug: string; name: string; description: string; managerEmail: string; active: boolean; webhookConfigured: boolean };

export default function ControlPanel({ initialShops }: { initialShops: Shop[] }) {
  const [shops, setShops] = useState(initialShops);
  const [drafts, setDrafts] = useState<Record<string, { managerEmail: string; active: boolean }>>(() => Object.fromEntries(initialShops.map((shop) => [shop.id, { managerEmail: shop.managerEmail, active: shop.active }])));
  const [form, setForm] = useState({ name: "", slug: "", managerEmail: "", description: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/control/shops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setShops((current) => [...current, result.shop]);
      setDrafts((current) => ({ ...current, [result.shop.id]: { managerEmail: result.shop.managerEmail, active: result.shop.active } }));
      setForm({ name: "", slug: "", managerEmail: "", description: "" }); setMessage("새 샵을 만들고 관리자를 지정했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "샵을 만들지 못했습니다."); }
    finally { setBusy(false); }
  };

  const update = async (shop: Shop) => {
    const draft = drafts[shop.id]; if (!draft) return; setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/control/shops/${shop.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setShops((current) => current.map((item) => item.id === shop.id ? { ...item, ...result.shop } : item)); setMessage(`${shop.name}의 관리자와 공개 상태를 저장했습니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const remove = async (shop: Shop) => {
    const typed = window.prompt(
      `"${shop.name}"을(를) 삭제합니다.\n\n`
      + `이 샵의 주문 기록과 저장된 도안·원본 파일까지 함께 지워지고, 되돌릴 수 없습니다.\n`
      + `잠시 내리는 것이라면 아래 "마켓과 주문 화면에 공개"를 끄는 쪽을 쓰세요.\n\n`
      + `그래도 삭제하려면 샵 주소를 그대로 입력하세요: ${shop.slug}`,
    );
    if (typed === null) return;
    if (typed.trim() !== shop.slug) { setMessage("입력한 주소가 달라서 삭제하지 않았습니다."); return; }

    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/control/shops/${shop.id}?confirm=${encodeURIComponent(shop.slug)}`, { method: "DELETE" });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || `삭제하지 못했습니다. (서버 응답 ${response.status})`);
      setShops((current) => current.filter((item) => item.id !== shop.id));
      setDrafts((current) => { const next = { ...current }; delete next[shop.id]; return next; });
      const r = result.removed;
      setMessage(`${r.name} 삭제됨 · 주문 ${r.orderCount}건 · 이미지 ${r.imageCount}장 · 파일 ${r.filesPurged}/${r.filesTotal}개 정리`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <main className="control-page"><header><Link href="/admin">← 샵 관리</Link><strong>DOT MARKET CONTROL</strong><Link href="/">마켓 보기</Link></header><section className="control-shell"><div className="control-intro"><p>SUPER ADMIN ONLY</p><h1>입점 샵 컨트롤</h1><span>총괄 관리자만 새 샵을 만들고 담당 관리자를 지정할 수 있습니다.</span></div><form className="create-shop-card" onSubmit={create}><div><h2>새 샵 만들기</h2><p>별도 관리자 비밀번호는 만들지 않습니다. 지정된 이메일로 로그인한 사람만 해당 샵을 관리합니다.</p></div><div className="create-fields"><label>샵 이름<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 루나 도트 공방"/></label><label>샵 주소<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="luna-pixel"/><small>/shop/{form.slug || "luna-pixel"}</small></label><label>샵 관리자 로그인 이메일<input required type="email" value={form.managerEmail} onChange={(e) => setForm({ ...form, managerEmail: e.target.value })} placeholder="manager@example.com"/><small>이 주소로 Cloudflare Access 로그인 코드를 받습니다</small></label><label className="wide">샵 소개<textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label></div><button disabled={busy}>{busy ? "처리 중…" : "샵 생성하기"}</button></form><div className="control-list-head"><h2>전체 샵</h2><span>{shops.length}개</span></div><div className="control-shop-list">{shops.map((shop) => { const draft = drafts[shop.id]; return <article key={shop.id}><div className="control-shop-title"><div><h3>{shop.name}</h3><span>/shop/{shop.slug}</span></div><i className={shop.webhookConfigured ? "ready" : "pending"}>{shop.webhookConfigured ? "웹훅 연결됨" : "웹훅 미연결"}</i></div><label>샵 관리자 로그인 이메일<input type="email" value={draft?.managerEmail ?? ""} onChange={(e) => setDrafts({ ...drafts, [shop.id]: { ...draft, managerEmail: e.target.value } })}/><small>Access에도 이 주소가 허용돼 있어야 로그인됩니다</small></label><label className="switch-row"><input type="checkbox" checked={draft?.active ?? false} onChange={(e) => setDrafts({ ...drafts, [shop.id]: { ...draft, active: e.target.checked } })}/><span>마켓과 주문 화면에 공개</span></label><div><Link href={`/shop/${shop.slug}`}>샵 보기 ↗</Link><div className="control-shop-actions"><button type="button" className="danger" onClick={() => remove(shop)} disabled={busy}>샵 삭제</button><button type="button" onClick={() => update(shop)} disabled={busy}>변경 저장</button></div></div></article>; })}</div>{message && <div className="control-message">{message}</div>}</section></main>;
}
