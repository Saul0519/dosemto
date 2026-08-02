"use client";

/**
 * Login state in the site header. A plain form POST for sign-out so it works
 * without client JS and cannot be triggered by a link prefetch.
 */
export default function AccountChip({ playerName, next }: {
  playerName: string | null;
  next: string;
}) {
  if (!playerName) {
    return (
      <a className="account-chip" href={`/login?next=${encodeURIComponent(next)}`}>
        로그인
      </a>
    );
  }

  return (
    <div className="account-chip is-in">
      <span title={playerName}>{playerName}</span>
      <form action={`/api/mc/logout?next=${encodeURIComponent(next)}`} method="post">
        <button type="submit">로그아웃</button>
      </form>
    </div>
  );
}
