"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { readResult } from "../read-result";
import { FieldKey, MAX_LENGTHS, checkField, firstProblem } from "../../db/application-fields";

const EMPTY: Record<FieldKey, string> = {
  mcNick: "", affiliation: "", job: "", email: "",
  shopName: "", wantedSlug: "", intro: "", note: "",
};

export default function ApplyForm({ applicantName, applicantId }: {
  applicantName: string;
  applicantId: string;
}) {
  const [values, setValues] = useState(EMPTY);
  // A field only complains once it has been left, so nothing is red on arrival.
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const set = (key: FieldKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setError("");
  };
  const leave = (key: FieldKey) => setTouched((current) => ({ ...current, [key]: true }));
  const problemFor = (key: FieldKey) => touched[key] ? checkField(key, values[key]) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = firstProblem(values);
    if (problem) {
      // Everything shows its own message at once, rather than one per attempt.
      setTouched({
        mcNick: true, affiliation: true, job: true, email: true,
        shopName: true, wantedSlug: true, intro: true, note: true,
      });
      setError(problem);
      return;
    }

    setBusy(true); setError("");
    try {
      const response = await fetch("/api/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
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

  const field = (key: FieldKey, label: string, extra?: { hint?: string; placeholder?: string; rows?: number; type?: string }) => {
    const problem = problemFor(key);
    return (
      <label className={problem ? "has-problem" : ""}>
        {label}
        {extra?.rows ? (
          <textarea
            value={values[key]}
            onChange={(event) => set(key, event.target.value)}
            onBlur={() => leave(key)}
            maxLength={MAX_LENGTHS[key]}
            rows={extra.rows}
            placeholder={extra.placeholder}
          />
        ) : (
          <input
            type={extra?.type ?? "text"}
            value={values[key]}
            onChange={(event) => set(key, event.target.value)}
            onBlur={() => leave(key)}
            maxLength={MAX_LENGTHS[key]}
            placeholder={extra?.placeholder}
            list={key === "affiliation" ? "apply-affiliations" : undefined}
          />
        )}
        {problem ? <small className="field-problem">{problem}</small> : extra?.hint ? <small>{extra.hint}</small> : null}
      </label>
    );
  };

  return (
    <form className="apply-form" onSubmit={submit} noValidate>
      <fieldset className="apply-group">
        <legend>누구신가요</legend>

        <div className="apply-auto">
          <span>디스코드</span>
          <b>{applicantName}</b>
          <code>{applicantId}</code>
          <small>로그인한 계정이 그대로 들어갑니다. 답도 이 계정으로 드립니다.</small>
        </div>

        {field("mcNick", "도스 닉네임", {
          placeholder: "실제 도스에서 사용 중인 닉네임",
          hint: "영문·숫자·밑줄(_)만. 게임에서 찾을 수 있어야 합니다.",
        })}

        <div className="apply-pair">
          {field("affiliation", "소속", { placeholder: "예: 예술협회, 도화숲" })}
          {field("job", "직업", { placeholder: "예: 화가" })}
        </div>
        {/* Suggestions, not a fixed list: someone from anywhere else can
            still type their own. */}
        <datalist id="apply-affiliations">
          <option value="예술협회"/>
          <option value="도화숲"/>
        </datalist>

        {field("email", "이메일", {
          type: "email",
          placeholder: "me@example.com",
          hint: "샵이 열리면 이 주소로 관리자 화면에 로그인합니다. 실제로 받을 수 있는 주소로 적어주세요.",
        })}
      </fieldset>

      <fieldset className="apply-group">
        <legend>어떤 가게인가요</legend>

        {field("shopName", "가게 이름", { placeholder: "예: 웨스트의 그림 공방" })}

        {field("wantedSlug", "원하는 주소", {
          placeholder: "west",
          hint: `영문 소문자·숫자·하이픈만. → /shop/${values.wantedSlug || "west"}`,
        })}

        {field("intro", "어떤 그림을 그리시나요", {
          rows: 4,
          placeholder: "주로 그리는 스타일, 보여드릴 수 있는 작업물 같은 걸 적어주세요.",
        })}

        {field("note", "하고 싶은 말", {
          rows: 3,
          placeholder: "그 밖에 전하고 싶은 내용이 있으면 적어주세요.",
        })}
      </fieldset>

      <button className="btn btn-solid" disabled={busy}>
        {busy ? "보내는 중…" : "입점 신청 보내기"}
      </button>
      {error && <p className="action-error">{error}</p>}
    </form>
  );
}
