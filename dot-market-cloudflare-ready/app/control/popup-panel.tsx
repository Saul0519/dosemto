"use client";

import { ChangeEvent, useState } from "react";
import { readResult } from "../read-result";
import type { Popup } from "../../db/popup";

export default function PopupPanel({ initialPopup, say, busy, setBusy }: {
  initialPopup: Popup;
  say: (text: string, kind?: "success" | "error") => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [popup, setPopup] = useState(initialPopup);
  const [draft, setDraft] = useState({
    active: initialPopup.active,
    linkUrl: initialPopup.linkUrl,
    alt: initialPopup.alt,
  });

  const dirty = draft.active !== popup.active
    || draft.linkUrl !== popup.linkUrl
    || draft.alt !== popup.alt;

  const run = async (work: () => Promise<void>, failure: string) => {
    setBusy(true); say("");
    try { await work(); }
    catch (error) { say(error instanceof Error ? error.message : failure, "error"); }
    finally { setBusy(false); }
  };

  const save = () => run(async () => {
    const response = await fetch("/api/control/popup", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    const result = await readResult<{ popup: Popup; warning?: string }>(response, "저장하지 못했습니다.");
    setPopup(result.popup);
    setDraft({ active: result.popup.active, linkUrl: result.popup.linkUrl, alt: result.popup.alt });
    if (result.warning) say(result.warning, "error");
    else say(result.popup.active ? "팝업을 켰습니다." : "팝업을 껐습니다.");
  }, "저장하지 못했습니다.");

  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("image", file);
    void run(async () => {
      const response = await fetch("/api/control/popup", { method: "POST", body: form });
      const result = await readResult<{ popup: Popup }>(response, "이미지를 올리지 못했습니다.");
      setPopup(result.popup);
      say("팝업 이미지를 올렸습니다. 이미 닫아둔 사람에게도 다시 보입니다.");
    }, "이미지를 올리지 못했습니다.").finally(() => { input.value = ""; });
  };

  const clear = () => {
    if (!window.confirm("팝업 이미지를 지웁니다. 팝업도 함께 꺼집니다.")) return;
    void run(async () => {
      const response = await fetch("/api/control/popup", { method: "DELETE" });
      const result = await readResult<{ popup: Popup }>(response, "지우지 못했습니다.");
      setPopup(result.popup);
      setDraft({ active: false, linkUrl: result.popup.linkUrl, alt: result.popup.alt });
      say("팝업 이미지를 지웠습니다.");
    }, "지우지 못했습니다.");
  };

  return (
    <>
      <div className="control-list-head">
        <h2>첫 화면 팝업</h2>
        <span>{popup.imageUrl ? (popup.active ? "켜짐" : "꺼짐") : "이미지 없음"}</span>
      </div>

      <div className="popup-admin">
        <div className="popup-preview">
          {popup.imageUrl
            // The URL never changes, so the version is tacked on to force a
            // reload after an upload instead of showing the cached old one.
            ? <img src={`${popup.imageUrl}?v=${encodeURIComponent(popup.version)}`} alt={popup.alt || "팝업 이미지"}/>
            : <span className="popup-preview-empty">이미지를 올리면 여기에 보입니다</span>}
        </div>

        <div className="popup-fields">
          <div className="popup-file">
            <label className="plain-upload-button">
              <input type="file" accept="image/*" onChange={upload} disabled={busy}/>
              <span>{popup.imageUrl ? "이미지 바꾸기" : "이미지 올리기"}</span>
            </label>
            {popup.imageUrl && (
              <button type="button" className="danger" onClick={clear} disabled={busy}>이미지 지우기</button>
            )}
          </div>

          <label>누르면 갈 주소
            <input
              value={draft.linkUrl}
              onChange={(event) => setDraft({ ...draft, linkUrl: event.target.value })}
              placeholder="https://discord.gg/… 또는 /store"
              maxLength={500}
            />
            <small>비우면 그냥 이미지로만 보입니다. 사이트 안이면 /store 처럼 적으세요.</small>
          </label>

          <label>이미지 설명
            <input
              value={draft.alt}
              onChange={(event) => setDraft({ ...draft, alt: event.target.value })}
              placeholder="예: 여름 할인 안내"
              maxLength={120}
            />
            <small>이미지가 안 뜰 때 대신 나오는 글입니다.</small>
          </label>

          <label className="switch-row">
            <input
              type="checkbox"
              checked={draft.active}
              disabled={!popup.imageUrl}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />
            <span>사이트 들어오면 띄우기</span>
          </label>
          {!popup.imageUrl && <p className="field-help">이미지를 올려야 켤 수 있습니다.</p>}

          <div className="application-actions">
            <button type="button" onClick={save} disabled={busy || !dirty}>
              {dirty ? "팝업 저장" : "저장됨"}
            </button>
          </div>
          <p className="field-help">
            방문자는 X로 닫거나 &quot;1주일 동안 보지 않기&quot;를 고를 수 있습니다. 내용을 바꾸면
            닫아둔 사람에게도 다시 보입니다.
          </p>
        </div>
      </div>
    </>
  );
}
