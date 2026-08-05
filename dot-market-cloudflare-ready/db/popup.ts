/**
 * The notice that greets people when they arrive.
 *
 * One row, because there is one front door. The image lives in the bucket like
 * every other upload; the row holds where it points and whether it is on.
 *
 * `version` changes whenever the popup does. The browser remembers a dismissal
 * against that value, so "1주일 동안 보지 않기" silences the notice someone
 * actually read and not whatever replaces it a week later.
 */

const ROW_ID = "popup";

export type Popup = {
  active: boolean;
  /** Where clicking it goes. Empty means the image is not a link. */
  linkUrl: string;
  /** Served through the site, so the bucket stays private. Null when no image. */
  imageUrl: string | null;
  /** Read by screen readers and shown if the image fails to load. */
  alt: string;
  version: string;
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
  await db.prepare(`CREATE TABLE IF NOT EXISTS site_popup (
    id TEXT PRIMARY KEY,
    active INTEGER NOT NULL DEFAULT 0,
    link_url TEXT NOT NULL DEFAULT '',
    alt TEXT NOT NULL DEFAULT '',
    object_key TEXT,
    content_type TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

type Row = {
  active: number; link_url: string; alt: string;
  object_key: string | null; content_type: string | null; updated_at: string;
};

/**
 * Only http(s) and same-site paths. The value ends up in an href, so anything
 * that could carry script has to be turned away rather than cleaned up.
 */
export function normaliseLink(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.startsWith("/") && !text.startsWith("//")) return text.slice(0, 500);
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().slice(0, 500);
  } catch {
    return "";
  }
}

async function read(): Promise<Row | null> {
  await ensureTable();
  const db = await getD1();
  return db.prepare(
    "SELECT active, link_url, alt, object_key, content_type, updated_at FROM site_popup WHERE id = ?",
  ).bind(ROW_ID).first<Row>().catch(() => null);
}

/** What the site shows. An active popup with no image has nothing to show. */
export async function getPopup(): Promise<Popup | null> {
  const row = await read().catch(() => null);
  if (!row || !row.active || !row.object_key) return null;
  return {
    active: true,
    linkUrl: row.link_url,
    imageUrl: `/api/popup-image?v=${encodeURIComponent(row.updated_at)}`,
    alt: row.alt,
    version: row.updated_at,
  };
}

/** The owner's view: on or off, image or not. */
export async function getPopupForOwner(): Promise<Popup> {
  const row = await read().catch(() => null);
  return {
    active: Boolean(row?.active),
    linkUrl: row?.link_url ?? "",
    imageUrl: row?.object_key ? "/api/control/popup/image" : null,
    alt: row?.alt ?? "",
    version: row?.updated_at ?? "",
  };
}

export async function savePopup(input: { active: boolean; linkUrl: string; alt: string }) {
  await ensureTable();
  const db = await getD1();
  await db.prepare(`INSERT INTO site_popup (id, active, link_url, alt, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      active = excluded.active,
      link_url = excluded.link_url,
      alt = excluded.alt,
      updated_at = CURRENT_TIMESTAMP`,
  ).bind(ROW_ID, input.active ? 1 : 0, normaliseLink(input.linkUrl), input.alt.trim().slice(0, 120)).run();
}

/** Replaces the picture and hands back the old key so the caller can clear it. */
export async function setPopupImage(objectKey: string, contentType: string) {
  await ensureTable();
  const db = await getD1();
  const previous = await read();
  await db.prepare(`INSERT INTO site_popup (id, object_key, content_type, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      object_key = excluded.object_key,
      content_type = excluded.content_type,
      updated_at = CURRENT_TIMESTAMP`,
  ).bind(ROW_ID, objectKey, contentType).run();
  return previous?.object_key ?? null;
}

export async function clearPopupImage() {
  await ensureTable();
  const db = await getD1();
  const previous = await read();
  // Nothing to show without a picture, so it comes off rather than showing blank.
  await db.prepare(
    "UPDATE site_popup SET object_key = NULL, content_type = NULL, active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(ROW_ID).run();
  return previous?.object_key ?? null;
}

export async function getPopupObjectKey() {
  const row = await read().catch(() => null);
  if (!row?.active || !row.object_key) return null;
  return { objectKey: row.object_key, contentType: row.content_type ?? "image/png" };
}

/** The stored picture whether the popup is on or off. Owner eyes only. */
export async function getPopupObjectKeyForOwner() {
  const row = await read().catch(() => null);
  if (!row?.object_key) return null;
  return { objectKey: row.object_key, contentType: row.content_type ?? "image/png" };
}
