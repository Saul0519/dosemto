"use client";

import { useState } from "react";

export default function LoginForm({ next }: { next: string }) {
  const [remember, setRemember] = useState(true);

  const href = `/api/mc/login?next=${encodeURIComponent(next)}${remember ? "&remember=1" : ""}`;

  return (
    <div className="login-actions">
      <label className="remember-row">
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)}/>
        <span>30일 동안 로그인 유지</span>
      </label>
      <a className="btn btn-solid" href={href}>
        마인크래프트로 로그인 <span className="arrow" aria-hidden="true">→</span>
      </a>
      <p className="action-note">
        체크를 풀면 브라우저를 닫을 때 로그아웃됩니다. 공용 PC라면 풀어두세요.
      </p>
    </div>
  );
}
