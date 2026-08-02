import { MC_SESSION_COOKIE, cookieHeader, safeNextPath } from "../../../../db/mc-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  return new Response(null, {
    status: 303,
    headers: {
      location: `${url.origin}${next}`,
      "set-cookie": cookieHeader(MC_SESSION_COOKIE, "", 0),
    },
  });
}
