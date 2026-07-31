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

  return <main className="control-page"><header><Link href="/admin">← 샵 관리</Link><strong>DOT MARKET CONTROL</strong><Link href="/">마켓 보기</Link></header><section className="control-shell"><div className="control-intro"><p>SUPER ADMIN ONLY</p><h1>입점 샵 컨트롤</h1><span>총괄 관리자만 새 샵을 만들고 담당 관리자를 지정할 수 있습니다.</span></div><form className="create-shop-card" onSubmit={create}><div><h2>새 샵 만들기</h2><p>별도 관리자 비밀번호는 만들지 않습니다. 지정된 이메일로 로그인한 사람만 해당 샵을 관리합니다.</p></div><div className="create-fields"><label>샵 이름<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 루나 도트 공방"/></label><label>샵 주소<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="luna-pixel"/><small>/shop/{form.slug || "luna-pixel"}</small></label><label>샵 관리자 로그인 이메일<input required type="email" value={form.managerEmail} onChange={(e) => setForm({ ...form, managerEmail: e.target.value })} placeholder="manager@example.com"/><small>관리자가 ChatGPT에 로그인할 때 사용하는 이메일</small></label><label className="wide">샵 소개<textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label></div><button disabled={busy}>{busy ? "처리 중…" : "샵 생성하기"}</button></form><div className="control-list-head"><h2>전체 샵</h2><span>{shops.length}개</span></div><div className="control-shop-list">{shops.map((shop) => { const draft = drafts[shop.id]; return <article key={shop.id}><div className="control-shop-title"><div><h3>{shop.name}</h3><span>/shop/{shop.slug}</span></div><i className={shop.webhookConfigured ? "ready" : "pending"}>{shop.webhookConfigured ? "웹훅 연결됨" : "웹훅 미연결"}</i></div><label>샵 관리자 로그인 이메일<input type="email" value={draft?.managerEmail ?? ""} onChange={(e) => setDrafts({ ...drafts, [shop.id]: { ...draft, managerEmail: e.target.value } })}/><small>이 이메일로 ChatGPT 로그인한 사람만 관리 가능</small></label><label className="switch-row"><input type="checkbox" checked={draft?.active ?? false} onChange={(e) => setDrafts({ ...drafts, [shop.id]: { ...draft, active: e.target.checked } })}/><span>마켓과 주문 화면에 공개</span></label><div><Link href={`/shop/${shop.slug}`}>샵 보기 ↗</Link><button type="button" onClick={() => update(shop)} disabled={busy}>변경 저장</button></div></article>; })}</div>{message && <div className="control-message">{message}</div>}</section></main>;
}
