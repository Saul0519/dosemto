"use client";

import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = "cloudflare-turnstile-script";

export default function TurnstileCaptcha({ siteKey, resetKey, onToken }: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    onToken("");
    if (!siteKey || !containerRef.current) {
      setState("error");
      return;
    }

    let cancelled = false;
    const render = () => {
      if (cancelled || !containerRef.current || !window.turnstile || widgetRef.current) return;
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: "place_order",
        theme: "light",
        language: "ko",
        appearance: "always",
        callback: (token: string) => {
          setState("ready");
          onToken(token);
        },
        "expired-callback": () => {
          onToken("");
          setState("loading");
        },
        "error-callback": () => {
          onToken("");
          setState("error");
        },
      });
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (window.turnstile) {
      render();
    } else if (existing) {
      existing.addEventListener("load", render, { once: true });
    } else {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", () => setState("error"), { once: true });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (existing) existing.removeEventListener("load", render);
      if (widgetRef.current && window.turnstile) {
        window.turnstile.remove(widgetRef.current);
        widgetRef.current = null;
      }
    };
  }, [siteKey, resetKey, onToken]);

  return (
    <div className={`captcha-box ${state}`}>
      <div ref={containerRef}/>
      {!siteKey && <p>샵의 로봇 방지 인증 설정이 필요합니다.</p>}
      {siteKey && state === "loading" && <p>보안 확인을 준비하고 있습니다.</p>}
      {siteKey && state === "error" && <p>보안 확인을 불러오지 못했습니다. 새로고침해 주세요.</p>}
    </div>
  );
}

