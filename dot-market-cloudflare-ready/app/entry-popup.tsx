"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Popup } from "../db/popup";

const STORAGE_KEY = "dm_popup_seen";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function readDismissal(version: string) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw) as { version?: string; until?: number };
    // A new popup is a new notice, so an old dismissal does not carry over.
    return saved.version === version && typeof saved.until === "number" && saved.until > Date.now();
  } catch {
    // Private browsing throws on read. Not being able to remember is not a
    // reason to hide the notice.
    return false;
  }
}

/**
 * Read as an external store rather than in an effect.
 *
 * The server cannot see localStorage, so it renders nothing and the client's
 * first pass agrees — the popup appears on the pass after hydration instead of
 * flashing up and being taken away from someone who already dismissed it.
 */
function useDismissed(version: string) {
  return useSyncExternalStore(
    () => () => undefined,
    () => readDismissal(version),
    () => true,
  );
}

export default function EntryPopup({ popup }: { popup: Popup }) {
  const dismissed = useDismissed(popup.version);
  const [closed, setClosed] = useState(false);
  const open = !dismissed && !closed && Boolean(popup.imageUrl);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setClosed(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const close = (forAWeek: boolean) => {
    if (forAWeek) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          version: popup.version,
          until: Date.now() + WEEK_MS,
        }));
      } catch {
        // Full or blocked storage. Closing still works, it just is not remembered.
      }
    }
    setClosed(true);
  };

  const picture = <img src={popup.imageUrl!} alt={popup.alt || "안내"}/>;

  return (
    <div
      className="entry-popup"
      role="dialog"
      aria-modal="true"
      aria-label={popup.alt || "사이트 안내"}
      onMouseDown={(event) => { if (event.target === event.currentTarget) setClosed(true); }}
    >
      <div className="entry-popup-box">
        <button type="button" className="entry-popup-x" onClick={() => setClosed(true)} aria-label="닫기">×</button>

        {popup.linkUrl
          ? (
            <a
              className="entry-popup-shot"
              href={popup.linkUrl}
              // Somewhere else gets the usual precautions and a new tab; a page
              // on this site should just navigate.
              {...(popup.linkUrl.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
              onClick={() => setClosed(true)}
            >
              {picture}
            </a>
          )
          : <div className="entry-popup-shot">{picture}</div>}

        <div className="entry-popup-foot">
          <button type="button" onClick={() => close(true)}>1주일 동안 보지 않기</button>
          <button type="button" onClick={() => close(false)}>닫기</button>
        </div>
      </div>
    </div>
  );
}
