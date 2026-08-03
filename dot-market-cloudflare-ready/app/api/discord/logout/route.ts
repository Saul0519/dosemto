import { SESSION_COOKIE, cookieHeader, safeNextPath } from "../../../../db/discord-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  return new Response(null, {
    status: 303,
    headers: {
      location: `${url.origin}${next}`,
      "set-cookie": cookieHeader(SESSION_COOKIE, "", 0),
    },
  });
}
