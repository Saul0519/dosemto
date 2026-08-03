"use client";

/**
 * Login state in the site header. A plain form POST for sign-out so it works
 * without client JS and cannot be triggered by a link prefetch.
 */
export default function AccountChip({ userName, next }: {
  userName: string | null;
  next: string;
}) {
  if (!userName) {
    return (
      <a className="account-chip" href={`/login?next=${encodeURIComponent(next)}`}>
        로그인
      </a>
    );
  }

  return (
    <div className="account-chip is-in">
      <a href="/me" title={userName}>{userName}</a>
      <form action={`/api/discord/logout?next=${encodeURIComponent(next)}`} method="post">
        <button type="submit">로그아웃</button>
      </form>
    </div>
  );
}
