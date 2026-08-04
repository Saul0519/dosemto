"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { readResult } from "../read-result";

export default function ApplyForm({ applicantName, applicantId }: {
  applicantName: string;
  applicantId: string;
}) {
  const [mcNick, setMcNick] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [job, setJob] = useState("");
  const [shopName, setShopName] = useState("");
  const [wantedSlug, setWantedSlug] = useState("");
  const [intro, setIntro] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!mcNick.trim()) { setError("마인크래프트 닉네임을 적어주세요."); return; }
    if (!shopName.trim()) { setError("가게 이름을 적어주세요."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mcNick, affiliation, job, shopName, wantedSlug, intro, note }),
      });
      await readResult(response, "신청을 보내지 못했습니다.");
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "신청을 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="action-done">
        <p className="action-done-title">입점 신청을 보냈습니다.</p>
        <p>사이트 운영자가 확인한 뒤 디스코드로 연락드립니다. 답을 받기 전까지는 한 번만 보내실 수 있습니다.</p>
        <Link className="btn btn-line" href="/">마켓으로 돌아가기</Link>
      </div>
    );
  }

  return (
    <form className="apply-form" onSubmit={submit}>
      <fieldset className="apply-group">
        <legend>누구신가요</legend>

        <div className="apply-auto">
          <span>디스코드</span>
          <b>{applicantName}</b>
          <code>{applicantId}</code>
          <small>로그인한 계정이 그대로 들어갑니다. 답도 이 계정으로 드립니다.</small>
        </div>

        <label>
          마인크래프트 닉네임
          <input
            value={mcNick}
            onChange={(event) => setMcNick(event.target.value)}
            maxLength={40}
            placeholder="게임에서 쓰는 이름"
            required
          />
        </label>

        <div className="apply-pair">
          <label>
            소속 <small>선택</small>
            <input
              value={affiliation}
              onChange={(event) => setAffiliation(event.target.value)}
              maxLength={60}
              placeholder="예: 상가이동 치이카와관"
            />
          </label>
          <label>
            직업 <small>선택</small>
            <input
              value={job}
              onChange={(event) => setJob(event.target.value)}
              maxLength={60}
              placeholder="예: 화가, 건축가"
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="apply-group">
        <legend>어떤 가게인가요</legend>

      <label>
        가게 이름
        <input
          value={shopName}
          onChange={(event) => setShopName(event.target.value)}
          maxLength={60}
          placeholder="예: 웨스트의 그림 공방"
          required
        />
      </label>

      <label>
        원하는 주소 <small>선택</small>
        <input
          value={wantedSlug}
          onChange={(event) => setWantedSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          maxLength={50}
          placeholder="west"
        />
        <small>영어 소문자·숫자·하이픈만. 비워두면 운영자가 정합니다. → /shop/{wantedSlug || "west"}</small>
      </label>

      <label>
        어떤 그림을 그리시나요 <small>선택</small>
        <textarea
          value={intro}
          onChange={(event) => setIntro(event.target.value)}
          maxLength={500}
          rows={4}
          placeholder="주로 그리는 스타일, 보여드릴 수 있는 작업물 같은 걸 적어주세요."
        />
      </label>

      <label>
        하고 싶은 말 <small>선택</small>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="그 밖에 전하고 싶은 내용이 있으면 적어주세요."
        />
      </label>

      </fieldset>

      <button className="btn btn-solid" disabled={busy}>
        {busy ? "보내는 중…" : "입점 신청 보내기"}
      </button>
      {error && <p className="action-error">{error}</p>}
    </form>
  );
}
