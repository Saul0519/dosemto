import {
  MC_SESSION_COOKIE,
  MC_STATE_COOKIE,
  cookieHeader,
  mcAuthConfig,
  readCookie,
  REMEMBER_SECONDS,
  safeNextPath,
  signPlayer,
} from "../../../../db/mc-session";

export const dynamic = "force-dynamic";

const TOKEN_URL = "https://mc-auth.com/oAuth2/token";

type TokenResponse = {
  access_token?: string;
  data?: { uuid?: string; profile?: { name?: string } };
};

function back(origin: string, next: string, error: string) {
  const target = new URL(`${origin}${next}`);
  target.searchParams.set("mc", error);
  return Response.redirect(target.toString(), 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // state | remember | next
  const [expectedState = "", rememberFlag = "0", ...rest] = (readCookie(request, MC_STATE_COOKIE) ?? "").split("|");
  const next = safeNextPath(rest.length ? rest.join("|") : "/");
  const remember = rememberFlag === "1";

  const clearState = cookieHeader(MC_STATE_COOKIE, "", 0);

  if (url.searchParams.get("error")) return back(url.origin, next, "denied");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !expectedState || state !== expectedState) {
    return back(url.origin, next, "state");
  }

  const { clientId, clientSecret, configured } = await mcAuthConfig();
  if (!configured) return back(url.origin, next, "unconfigured");

  let player: { uuid: string; name: string };
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "DOT-MARKET/1.0 (+https://dosemto.store)",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${url.origin}/api/mc/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) return back(url.origin, next, "exchange");
    const result = await response.json() as TokenResponse;
    const uuid = result.data?.uuid;
    const name = result.data?.profile?.name;
    if (!uuid || !name) return back(url.origin, next, "profile");
    player = { uuid, name };
  } catch {
    return back(url.origin, next, "network");
  }

  const target = new URL(`${url.origin}${next}`);
  target.searchParams.set("mc", "ok");
  return new Response(null, {
    status: 302,
    headers: [
      ["location", target.toString()],
      ["set-cookie", clearState],
      ["set-cookie", cookieHeader(MC_SESSION_COOKIE, await signPlayer(player), remember ? REMEMBER_SECONDS : null)],
    ],
  });
}
