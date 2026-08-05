/**
 * Requests to open a shop on the market.
 *
 * Anyone signed in with Discord can send one; only the site owner reads them.
 * The applicant's Discord account is captured rather than typed, so the owner
 * always has someone to reply to and a name nobody could have made up.
 */

import { FieldKey, firstProblem } from "./application-fields";

export type ShopApplication = {
  id: string;
  /** The name they actually go by on 도스온라인, so the owner can find them. */
  mcNick: string;
  /** Town, shop street, guild: wherever they are based in game. */
  affiliation: string;
  /** What they do on the server. */
  job: string;
  /** Where the owner would grant them manager access. */
  email: string;
  shopName: string;
  /** The address they would like, if they had a preference. */
  wantedSlug: string;
  intro: string;
  note: string;
  applicantId: string;
  applicantName: string;
  handled: boolean;
  createdAt: string;
};

type Row = {
  id: string;
  mc_nick: string;
  affiliation: string;
  job: string;
  email: string;
  shop_name: string;
  wanted_slug: string;
  intro: string;
  note: string;
  applicant_id: string;
  applicant_name: string;
  status: string;
  created_at: string;
};

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

let migrateReady: Promise<void> | null = null;

async function ensureTable() {
  if (!migrateReady) {
    migrateReady = migrate().catch((error) => { migrateReady = null; throw error; });
  }
  return migrateReady;
}

async function migrate() {
  const db = await getD1();
  await db.prepare(`CREATE TABLE IF NOT EXISTS shop_applications (
    id TEXT PRIMARY KEY,
    shop_name TEXT NOT NULL,
    wanted_slug TEXT NOT NULL DEFAULT '',
    intro TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    applicant_id TEXT NOT NULL,
    applicant_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS shop_applications_status_idx ON shop_applications (status, created_at DESC)",
  ).run();
  // Added after the first version; tolerant so an existing table keeps working.
  for (const column of ["mc_nick", "affiliation", "job", "email"]) {
    await db.prepare(`ALTER TABLE shop_applications ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`)
      .run().catch(() => undefined);
  }
}

function toApplication(row: Row): ShopApplication {
  return {
    id: row.id,
    mcNick: row.mc_nick ?? "",
    affiliation: row.affiliation ?? "",
    job: row.job ?? "",
    email: row.email ?? "",
    shopName: row.shop_name,
    wantedSlug: row.wanted_slug,
    intro: row.intro,
    note: row.note,
    applicantId: row.applicant_id,
    applicantName: row.applicant_name,
    handled: row.status === "handled",
    createdAt: row.created_at,
  };
}

/** How many requests this account already has waiting to be read. */
async function pendingCount(applicantId: string) {
  const db = await getD1();
  const row = await db.prepare(
    "SELECT COUNT(*) AS count FROM shop_applications WHERE applicant_id = ? AND status = 'new'",
  ).bind(applicantId).first<{ count: number }>().catch(() => null);
  return row?.count ?? 0;
}

type Outcome = { ok: true } | { ok: false; error: string; status: number };

export async function submitApplication(input: {
  applicantId: string;
  applicantName: string;
  mcNick: string;
  affiliation: string;
  job: string;
  email: string;
  shopName: string;
  wantedSlug: string;
  intro: string;
  note: string;
}): Promise<Outcome> {
  await ensureTable();

  // Same rules the form shows while typing, so a message someone read is the
  // one that actually decides. Every field is required.
  const values: Record<FieldKey, string> = {
    mcNick: input.mcNick ?? "",
    affiliation: input.affiliation ?? "",
    job: input.job ?? "",
    email: input.email ?? "",
    shopName: input.shopName ?? "",
    wantedSlug: input.wantedSlug ?? "",
    intro: input.intro ?? "",
    note: input.note ?? "",
  };
  const problem = firstProblem(values);
  if (problem) return { ok: false, error: problem, status: 400 };

  // One open request per person. Sending a second changes nothing for the
  // owner and just buries the first.
  if (await pendingCount(input.applicantId) >= 1) {
    return {
      ok: false,
      error: "이미 보내신 입점 신청이 검토 중입니다. 답을 받으신 뒤에 다시 보내주세요.",
      status: 409,
    };
  }

  const db = await getD1();
  await db.prepare(`INSERT INTO shop_applications
    (id, mc_nick, affiliation, job, email, shop_name, wanted_slug, intro, note, applicant_id, applicant_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    values.mcNick.trim(),
    values.affiliation.trim(),
    values.job.trim(),
    values.email.trim(),
    values.shopName.trim(),
    values.wantedSlug.trim().toLowerCase(),
    values.intro.trim(),
    values.note.trim(),
    input.applicantId,
    input.applicantName.slice(0, 80),
  ).run();

  return { ok: true };
}

export async function listApplications(limit = 100): Promise<ShopApplication[]> {
  await ensureTable();
  const db = await getD1();
  const rows = await db.prepare(
    // Unread first: those are the ones needing an answer.
    `SELECT id, mc_nick, affiliation, job, email, shop_name, wanted_slug, intro, note,
            applicant_id, applicant_name, status, created_at
       FROM shop_applications
      ORDER BY status = 'new' DESC, created_at DESC LIMIT ?`,
  ).bind(limit).all<Row>().catch(() => ({ results: [] as Row[] }));
  return rows.results.map(toApplication);
}

export async function countPendingApplications() {
  await ensureTable();
  const db = await getD1();
  const row = await db.prepare(
    "SELECT COUNT(*) AS count FROM shop_applications WHERE status = 'new'",
  ).first<{ count: number }>().catch(() => null);
  return row?.count ?? 0;
}

export async function setApplicationHandled(id: string, handled: boolean): Promise<Outcome> {
  await ensureTable();
  const db = await getD1();
  const changed = await db.prepare("UPDATE shop_applications SET status = ? WHERE id = ?")
    .bind(handled ? "handled" : "new", id).run().catch(() => null);
  if (!changed?.meta.changes) return { ok: false, error: "그 신청을 찾지 못했습니다.", status: 404 };
  return { ok: true };
}

export async function deleteApplication(id: string): Promise<Outcome> {
  await ensureTable();
  const db = await getD1();
  const removed = await db.prepare("DELETE FROM shop_applications WHERE id = ?")
    .bind(id).run().catch(() => null);
  if (!removed?.meta.changes) return { ok: false, error: "그 신청을 찾지 못했습니다.", status: 404 };
  return { ok: true };
}
