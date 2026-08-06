/**
 * A very small Markdown renderer for owner-written notices.
 *
 * Import-free so the page and the route can share it.
 *
 * Everything is escaped before any markup is added, so nothing in the source
 * text can become a tag. Only the handful of shapes below are turned into
 * elements — no raw HTML passes through, even though the only person who can
 * write this text is the site owner. A notice about not tampering with things
 * should not itself be a way to inject a script.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/** Discord writes these; on a web page they should be the picture itself. */
const EMOJI: Record<string, string> = {
  pushpin: "📌", scales: "⚖️", mag_right: "🔎", mag: "🔍", receipt: "🧾",
  pray: "🙏", warning: "⚠️", lock: "🔒", key: "🔑", memo: "📝",
  bulb: "💡", no_entry: "⛔", white_check_mark: "✅", x: "❌",
  bangbang: "‼️", exclamation: "❗", book: "📘", page_facing_up: "📄",
};

/** Inline marks, applied to already-escaped text. */
function inline(text: string) {
  return text
    .replace(/:([a-z0-9_+-]+):/gi, (whole, name: string) => EMOJI[name] ?? whole)
    // Links are opt-in and http(s) only; anything else stays as plain text.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_whole, label: string, href: string) =>
        `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

const BULLET = /^\s*(?:[-*・·•]|・)\s+/;

/**
 * Returns HTML for a block of Markdown. Safe to place in dangerouslySetInnerHTML
 * because the input was escaped first and only these tags are ever produced.
 */
export function renderMarkdown(source: string) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    out.push(`<ul>${list.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${paragraph.join("<br/>")}</p>`);
    paragraph = [];
  };
  const flush = () => { flushList(); flushParagraph(); };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) { flush(); continue; }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 1, 5);
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push("<hr/>"); continue; }

    if (BULLET.test(line)) {
      flushParagraph();
      list.push(inline(escapeHtml(line.replace(BULLET, ""))));
      continue;
    }

    flushList();
    paragraph.push(inline(escapeHtml(line.trim())));
  }

  flush();
  return out.join("");
}
