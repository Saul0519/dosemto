/**
 * A player's head next to their name.
 *
 * Server and client both render it, so it lives on its own with no hooks and no
 * "use client" — a plain function either side can call.
 */

export default function McHead({ nick, size = 20 }: { nick: string; size?: number }) {
  const clean = nick.trim();
  if (!clean) return null;
  return (
    // Not lazily loaded. These are half a kilobyte each, cached for a day, and
    // the same few players fill most of a page — deferring them buys nothing,
    // and a row whose face arrives late is a row that moves while being read.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="mc-head"
      src={`/api/skin/${encodeURIComponent(clean)}`}
      alt=""
      width={size}
      height={size}
      fetchPriority="low"
      decoding="async"
    />
  );
}

/** The head and the name together, which is how it is wanted nearly everywhere. */
export function McName({ nick, size = 20 }: { nick: string; size?: number }) {
  const clean = nick.trim();
  if (!clean) return null;
  return (
    <span className="mc-name">
      <McHead nick={clean} size={size}/>
      <span>{clean}</span>
    </span>
  );
}
