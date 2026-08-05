"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { readResult } from "../read-result";
import StorePanel from "./store-panel";
import { StoreItem, StorePurchase } from "../../db/store";

type Shop = { id: string; slug: string; name: string; description: string; managerEmail: string; active: boolean; webhookConfigured: boolean; premium: boolean };
type ModeratedReview = {
  id: string; orderId: string; rating: number; body: string;
  displayName: string; createdAt: string; shopName: string; hidden: boolean;
};

type Draft = { managerEmail: string; active: boolean; premium: boolean; featureRank: number };

type Application = {
  id: string; mcNick: string; affiliation: string; job: string; email: string;
  shopName: string; wantedSlug: string; intro: string; note: string;
  applicantId: string; applicantName: string; handled: boolean; createdAt: string;
};

export default function ControlPanel({
  initialShops, initialReviews, initialApplications, initialFeatureRanks, dmInviteUrl,
  storeItems, storePurchases, storeChannelId,
}: {
  initialShops: Shop[];
  initialReviews: ModeratedReview[];
  initialApplications: Application[];
  /** Hand-set positions in the recommended list, by shop id. Owner eyes only. */
  initialFeatureRanks: Record<string, number>;
  /** Invites the bot with no permissions at all, purely so it can DM members. */
  dmInviteUrl: string;
  storeItems: StoreItem[];
  storePurchases: StorePurchase[];
  storeChannelId: string;
}) {
  const [shops, setShops] = useState(initialShops);
  const [reviews, setReviews] = useState(initialReviews);
  const [applications, setApplications] = useState(initialApplications);
  // What is actually stored, so an edited position reads as unsaved and a saved
  // one stops. The prop is only the starting point.
  const [savedRanks, setSavedRanks] = useState(initialFeatureRanks);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(
    initialShops.map((shop) => [shop.id, {
      managerEmail: shop.managerEmail,
      active: shop.active,
      premium: shop.premium,
      featureRank: initialFeatureRanks[shop.id] ?? 0,
    }]),
  ));
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
    if (!draft) return false;
    return draft.managerEmail !== shop.managerEmail
      || draft.active !== shop.active
      || draft.premium !== shop.premium
      || draft.featureRank !== (savedRanks[shop.id] ?? 0);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); say("");
    try {
      const response = await fetch("/api/control/shops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const result = await readResult<{ shop: Shop }>(response, "샵을 만들지 못했습니다.");
      setShops((current) => [...current, result.shop]);
      setDrafts((current) => ({ ...current, [result.shop.id]: {
        managerEmail: result.shop.managerEmail, active: result.shop.active,
        premium: result.shop.premium, featureRank: 0,
      } }));
      setForm({ name: "", slug: "", managerEmail: "", description: "" }); say("새 샵을 만들고 관리자를 지정했습니다.");
    } catch (error) { say(error instanceof Error ? error.message : "샵을 만들지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  const update = async (shop: Shop) => {
    const draft = drafts[shop.id]; if (!draft) return; setBusy(true); say("");
    try {
      const response = await fetch(`/api/control/shops/${shop.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const result = await readResult<{ shop: Shop }>(response, "변경하지 못했습니다.");
      setShops((current) => current.map((item) => item.id === shop.id ? { ...item, ...result.shop } : item));
      setSavedRanks((current) => ({ ...current, [shop.id]: draft.featureRank }));
      say(`${shop.name} 저장했습니다.`);
    } catch (error) { say(error instanceof Error ? error.message : "변경하지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  const remove = async (shop: Shop) => {
    const typed = window.prompt(
      `"${shop.name}"을(를) 삭제합니다.\n\n`
      + `이 샵의 주문 기록과 손님들이 남긴 후기, 저장된 그림 파일까지 함께 지워지고, 되돌릴 수 없습니다.\n`
      + `잠시 내리는 것이라면 아래 "마켓과 주문 화면에 공개"를 끄는 쪽을 쓰세요.\n\n`
      + `그래도 삭제하려면 샵 주소를 그대로 입력하세요: ${shop.slug}`,
    );
    if (typed === null) return;
    if (typed.trim() !== shop.slug) { say("입력한 주소가 달라서 삭제하지 않았습니다.", "error"); return; }

    setBusy(true); say("");
    try {
      const response = await fetch(`/api/control/shops/${shop.id}?confirm=${encodeURIComponent(shop.slug)}`, { method: "DELETE" });
      const result = await readResult<{ removed: Record<string, number | string> }>(response, "삭제하지 못했습니다.");
      setShops((current) => current.filter((item) => item.id !== shop.id));
      setDrafts((current) => { const next = { ...current }; delete next[shop.id]; return next; });
      const r = result.removed;
      say(`${r.name} 삭제됨 · 주문 ${r.orderCount}건 · 후기 ${r.reviewCount}건 · 이미지 ${r.imageCount}장 · 파일 ${r.filesPurged}/${r.filesTotal}개 정리`);
    } catch (error) { say(error instanceof Error ? error.message : "삭제하지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  const markApplication = async (application: Application, handled: boolean) => {
    setBusy(true); say("");
    try {
      const response = await fetch(`/api/control/applications/${application.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handled }),
      });
      const result = await readResult<{ applications: Application[] }>(response, "처리하지 못했습니다.");
      setApplications(result.applications);
      say(handled ? "처리한 신청으로 옮겼습니다." : "다시 대기 중으로 되돌렸습니다.");
    } catch (error) { say(error instanceof Error ? error.message : "처리하지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  const removeApplication = async (application: Application) => {
    if (!window.confirm(`${application.applicantName}님의 "${application.shopName}" 신청을 지웁니다. 되돌릴 수 없습니다.`)) return;
    setBusy(true); say("");
    try {
      const response = await fetch(`/api/control/applications/${application.id}`, { method: "DELETE" });
      const result = await readResult<{ applications: Application[] }>(response, "지우지 못했습니다.");
      setApplications(result.applications);
      say("신청을 지웠습니다.");
    } catch (error) { say(error instanceof Error ? error.message : "지우지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  /** Drops the application into the create form so it does not get retyped. */
  const fillFromApplication = (application: Application) => {
    setForm({
      name: application.shopName,
      slug: application.wantedSlug,
      managerEmail: application.email,
      description: application.intro,
    });
    say(`"${application.shopName}" 내용을 새 샵 만들기에 채웠습니다. 확인하고 만드세요.`);
    document.querySelector(".create-shop-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const toggleReview = async (review: ModeratedReview) => {
    setBusy(true); say("");
    try {
      const response = await fetch(`/api/control/reviews/${encodeURIComponent(review.orderId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hidden: !review.hidden }),
      });
      await readResult(response, "처리하지 못했습니다.");
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
      await readResult(response, "지우지 못했습니다.");
      setReviews((current) => current.filter((item) => item.orderId !== review.orderId));
      say(`${review.orderId} 후기를 완전히 삭제했습니다.`);
    } catch (error) { say(error instanceof Error ? error.message : "지우지 못했습니다.", "error"); }
    finally { setBusy(false); }
  };

  return <main className="control-page"><header><Link href="/admin">← 샵 관리</Link><strong>DOT MARKET CONTROL</strong><Link href="/">마켓 보기</Link></header><section className="control-shell"><div className="control-intro"><p>SUPER ADMIN ONLY</p><h1>입점 샵 컨트롤</h1><span>총괄 관리자만 새 샵을 만들고 담당 관리자를 지정할 수 있습니다.</span></div><form className="create-shop-card" onSubmit={create}><div><h2>새 샵 만들기</h2><p>별도 관리자 비밀번호는 만들지 않습니다. 지정된 이메일로 로그인한 사람만 해당 샵을 관리합니다.</p></div><div className="create-fields"><label>샵 이름<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 루나 도트 공방"/></label><label>샵 주소<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="luna-pixel"/><small>/shop/{form.slug || "luna-pixel"}</small></label><label>샵 관리자 로그인 이메일<input required type="email" value={form.managerEmail} onChange={(e) => setForm({ ...form, managerEmail: e.target.value })} placeholder="manager@example.com"/><small>이 주소로 Cloudflare Access 로그인 코드를 받습니다</small></label><label className="wide">샵 소개<textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label></div><button disabled={busy}>{busy ? "처리 중…" : "샵 생성하기"}</button></form><section className="dm-reach"><h2>손님에게 디스코드 알림이 가게 하려면</h2><p>봇은 <b>같은 서버에 있는 사람에게만</b> DM을 보낼 수 있습니다. 지금은 각 샵의 서버에만 들어가 있어서, 그 서버에 없는 손님은 수락·거절·완성 알림을 DM으로 받지 못합니다. (내 주문 화면에서는 항상 보입니다.)</p><p>도스온라인 본서버에 봇을 넣어두면 그 서버에 있는 사람 전원에게 DM이 갑니다. 아래 링크는 <b>권한을 하나도 요구하지 않습니다</b> — 채널을 읽지도, 글을 쓰지도 못하고, 그저 서버에 있기만 합니다.</p>{dmInviteUrl ? <a className="plain-upload-button" href={dmInviteUrl} target="_blank" rel="noreferrer">권한 없이 서버에 초대하기 ↗</a> : <p className="field-help">디스코드 설정이 아직 안 되어 있습니다.</p>}<p className="field-help">서버에 봇을 추가하려면 그 서버에서 &quot;서버 관리&quot; 권한이 필요합니다. 없으면 서버 주인에게 이 링크를 전달해 주세요.</p></section><div className="control-list-head"><h2>입점 신청</h2><span>대기 {applications.filter((a) => !a.handled).length}건 · 전체 {applications.length}건</span></div><div className="application-list">{applications.length === 0 ? <p className="field-help">아직 들어온 신청이 없습니다. 마켓 샵 목록 끝의 빈 칸을 눌러 신청할 수 있습니다.</p> : applications.map((application) => (<article key={application.id} className={application.handled ? "handled" : ""}><div className="application-head"><b>{application.shopName}</b>{application.wantedSlug && <code>/shop/{application.wantedSlug}</code>}{application.handled ? <em>처리함</em> : <i>대기 중</i>}</div><div className="application-who"><span>{application.mcNick || application.applicantName}</span>{(application.affiliation || application.job) && <small>{[application.affiliation, application.job].filter(Boolean).join(" · ")}</small>}<code>{application.email}</code><code>{application.applicantName} · {application.applicantId}</code><time dateTime={application.createdAt}>{application.createdAt.slice(0, 10)}</time></div>{application.intro && <p>{application.intro}</p>}{application.note && <p className="application-note">{application.note}</p>}<div className="application-actions"><button type="button" onClick={() => fillFromApplication(application)} disabled={busy}>이 내용으로 샵 만들기</button><button type="button" onClick={() => markApplication(application, !application.handled)} disabled={busy}>{application.handled ? "대기로 되돌리기" : "처리함으로"}</button><button type="button" className="danger" onClick={() => removeApplication(application)} disabled={busy}>삭제</button></div></article>))}</div><div className="control-list-head"><h2>전체 샵</h2><span>{shops.length}개</span></div><div className="control-shop-list">{shops.map((shop) => { const draft = drafts[shop.id]; return <article key={shop.id}><div className="control-shop-title"><div><h3>{shop.name}</h3><span>/shop/{shop.slug}</span></div><i className={shop.webhookConfigured ? "ready" : "pending"}>{shop.webhookConfigured ? "웹훅 연결됨" : "웹훅 미연결"}</i></div><label>샵 관리자 로그인 이메일<input type="email" value={draft?.managerEmail ?? ""} onChange={(e) => setDrafts({ ...drafts, [shop.id]: { ...draft, managerEmail: e.target.value } })}/><small>Access에도 이 주소가 허용돼 있어야 로그인됩니다</small></label><label className="switch-row"><input type="checkbox" checked={draft?.active ?? false} onChange={(e) => setDrafts({ ...drafts, [shop.id]: { ...draft, active: e.target.checked } })}/><span>마켓과 주문 화면에 공개</span></label><label className="switch-row"><input type="checkbox" checked={draft?.premium ?? false} onChange={(e) => setDrafts({ ...drafts, [shop.id]: { ...draft, premium: e.target.checked } })}/><span>프리미엄 표시</span></label><label className="rank-row">추천순 고정 위치<input type="number" min={0} max={999} value={draft?.featureRank ?? 0} onChange={(e) => setDrafts({ ...drafts, [shop.id]: { ...draft, featureRank: Math.max(0, Math.min(999, Math.trunc(Number(e.target.value) || 0))) } })}/><small>1이 맨 앞. 0이면 평점·후기대로 자동 정렬됩니다. 이 값은 총괄만 보이고 어디에도 표시되지 않습니다.</small></label><div className={`control-shop-foot${isDirty(shop) ? " dirty" : ""}`}><Link href={`/shop/${shop.slug}`}>샵 보기 ↗</Link><span className="control-save-state">{isDirty(shop) ? "저장하지 않은 변경사항" : "저장됨"}</span><div className="control-shop-actions"><button type="button" className="danger" onClick={() => remove(shop)} disabled={busy}>샵 삭제</button><button type="button" onClick={() => update(shop)} disabled={busy || !isDirty(shop)}>{isDirty(shop) ? "변경 저장" : "저장됨"}</button></div></div></article>; })}</div><StorePanel initialItems={storeItems} initialPurchases={storePurchases} initialChannelId={storeChannelId} say={say} busy={busy} setBusy={setBusy}/><div className="control-list-head"><h2>전체 후기</h2><span>{reviews.length}개 · 숨김 {reviews.filter((r) => r.hidden).length}개</span></div><div className="moderation-list">{reviews.length === 0 ? <p className="field-help">아직 후기가 없습니다.</p> : reviews.map((review) => (<article key={review.id} className={review.hidden ? "hidden-review" : ""}><div className="moderation-head"><b>{"★".repeat(review.rating)}<i>{"★".repeat(5 - review.rating)}</i></b><span>{review.displayName}</span><small>{review.shopName}</small><code>{review.orderId}</code>{review.hidden && <em>숨김</em>}</div>{review.body && <p>{review.body}</p>}<div className="moderation-actions"><button type="button" onClick={() => toggleReview(review)} disabled={busy}>{review.hidden ? "다시 보이기" : "숨기기"}</button><button type="button" className="danger" onClick={() => purge(review)} disabled={busy}>완전 삭제</button></div></article>))}</div>{message && <div className={`control-message ${messageKind}`}>{message}</div>}</section></main>;
}
