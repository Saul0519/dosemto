/**
 * What a shop application accepts in each field.
 *
 * Import-free and shared by the form and the route, so the message someone
 * reads while typing is the same rule that decides whether the request is
 * kept. Two copies of these would drift, and the drift would show up as a
 * form that refuses to submit without saying why.
 */

export type FieldKey =
  | "mcNick" | "affiliation" | "job" | "email"
  | "shopName" | "wantedSlug" | "intro" | "note";

/** Minecraft account names: ASCII letters, digits and underscore, 3–16. */
const MC_NICK = /^[A-Za-z0-9_]{3,16}$/;

/** Deliberately ASCII-only. The previous check accepted 한글@한글.com. */
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** The shape a URL path can take. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const MAX_LENGTHS: Record<FieldKey, number> = {
  mcNick: 16,
  affiliation: 60,
  job: 60,
  email: 120,
  shopName: 60,
  wantedSlug: 50,
  intro: 500,
  note: 500,
};

/**
 * Returns a message when the value will not do, or null when it will. Every
 * field is required — a half-filled application is one the owner has to chase.
 */
export function checkField(key: FieldKey, raw: string): string | null {
  const value = raw.trim();

  if (!value) return REQUIRED_MESSAGES[key];
  if (value.length > MAX_LENGTHS[key]) {
    return `${LABELS[key]}은(는) ${MAX_LENGTHS[key]}자까지 쓸 수 있습니다.`;
  }

  if (key === "mcNick" && !MC_NICK.test(value)) {
    return "도스 닉네임은 영문·숫자·밑줄(_) 3~16자입니다. 한글이나 공백은 게임 닉네임에 쓸 수 없습니다.";
  }
  if (key === "email" && !EMAIL.test(value)) {
    return "이메일을 영문 주소로 정확히 적어주세요. 한글이 섞이면 로그인에 쓸 수 없습니다.";
  }
  if (key === "wantedSlug") {
    if (!SLUG.test(value)) {
      return "원하는 주소는 영문 소문자·숫자·하이픈(-)만 쓸 수 있습니다. 한글과 공백은 주소에 들어갈 수 없습니다.";
    }
    if (value.length < 3) return "원하는 주소는 3자 이상으로 적어주세요.";
  }

  return null;
}

const LABELS: Record<FieldKey, string> = {
  mcNick: "도스 닉네임",
  affiliation: "소속",
  job: "직업",
  email: "이메일",
  shopName: "가게 이름",
  wantedSlug: "원하는 주소",
  intro: "어떤 그림을 그리는지",
  note: "하고 싶은 말",
};

const REQUIRED_MESSAGES: Record<FieldKey, string> = {
  mcNick: "도스에서 쓰는 닉네임을 적어주세요.",
  affiliation: "소속을 적어주세요. 없으면 '없음'이라고 적어주셔도 됩니다.",
  job: "직업을 적어주세요.",
  email: "관리자 로그인에 쓸 이메일을 적어주세요.",
  shopName: "가게 이름을 적어주세요.",
  wantedSlug: "원하는 샵 주소를 적어주세요.",
  intro: "어떤 그림을 그리시는지 적어주세요.",
  note: "하고 싶은 말을 적어주세요. 없으면 '없음'이라고 적어주셔도 됩니다.",
};

export const FIELD_ORDER: FieldKey[] = [
  "mcNick", "affiliation", "job", "email",
  "shopName", "wantedSlug", "intro", "note",
];

/** The first problem in the whole form, in the order the fields are shown. */
export function firstProblem(values: Record<FieldKey, string>): string | null {
  for (const key of FIELD_ORDER) {
    const problem = checkField(key, values[key] ?? "");
    if (problem) return problem;
  }
  return null;
}
