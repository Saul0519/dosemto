"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Nudge } from "../db/review-nudge";

const STORAGE_KEY = "dm_review_nudge";

function isMuted() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "off";
  } catch {
    return false;
  }
}

/**
 * Read as an external store, not in an effect, so the server and the first
 * client render agree on showing nothing and the card appears once — instead of
 * flashing at someone who already said no.
 */
function useMuted() {
  return useSyncExternalStore(() => () => undefined, isMuted, () => true);
}

/**
 * Asks a returning customer to write the review they never got round to.
 *
 * "다시 보지 않기" is permanent on purpose. Someone who says no to this is
 * saying no to being asked, not to being asked about one particular order —
 * pestering them again next week would be the same request in a thin disguise.
 * They can still leave a review any time from 내 주문.
 */
export default function ReviewNudge({ nudge }: { nudge: Nudge }) {
  const muted = useMuted();
  const [closed, setClosed] = useState(false);
  if (muted || closed) return null;

  const mute = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "off");
    } catch {
      // Private browsing. Closing works, it just is not remembered.
    }
    setClosed(true);
  };

  return (
    <div className="nudge" role="complementary" aria-label="후기 부탁">
      <button type="button" className="nudge-x" onClick={() => setClosed(true)} aria-label="닫기">×</button>

      <p className="nudge-eyebrow">잠깐!</p>
      <p className="nudge-line">
        {nudge.kind === "order"
          ? <><b>{nudge.what}</b>에서 받으신 그림, 어떠셨나요?</>
          : <><b>{nudge.what}</b>, 잘 쓰고 계신가요?</>}
      </p>
      <p className="nudge-why">
        후기 한 줄이면 다음 사람이 고르는 데 큰 도움이 되고, 열심히 한 쪽에도 힘이 됩니다.
        {nudge.others > 0 && ` 남기실 수 있는 게 ${nudge.others + 1}건 있어요.`}
      </p>

      <div className="nudge-actions">
        <Link className="btn btn-solid" href={nudge.href}>
          후기 작성하러 이동 <span aria-hidden="true">→</span>
        </Link>
        <button type="button" onClick={mute}>다시 보지 않기</button>
      </div>
    </div>
  );
}
