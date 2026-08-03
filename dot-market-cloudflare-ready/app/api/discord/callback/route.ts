import {
  REMEMBER_SECONDS,
  SESSION_COOKIE,
  STATE_COOKIE,
  cookieHeader,
  discordConfig,
  readCookie,
  safeNextPath,
  signUser,
} from "../../../../db/discord-session";

export const dynamic = "force-dynamic";

const TOKEN_URL = "https://discord.com/api/oauth2/token";
const USER_URL = "https://discord.com/api/users/@me";

type TokenResponse = { access_token?: string };
type UserResponse = { id?: string; username?: string; global_name?: string | null };

/**
 * Failures go back to /login, not to wherever the visitor came from. The
 * destination page has nowhere to show the reason, so sending them there just
 * looks like the login silently did nothing.
 */
function back(origin: string, next: string, error: string) {
  const target = new URL(`${origin}/login`);
  target.searchParams.set("login", error);
  if (next !== "/") target.searchParams.set("next", next);
  return Response.redirect(target.toString(), 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // state | remember | next
  const [expectedState = "", rememberFlag = "0", ...rest] = (readCookie(request, STATE_COOKIE) ?? "").split("|");
  const next = safeNextPath(rest.length ? rest.join("|") : "/");
  const remember = rememberFlag === "1";
  const clearState = cookieHeader(STATE_COOKIE, "", 0);

  if (url.searchParams.get("error")) return back(url.origin, next, "denied");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !expectedState || state !== expectedState) return back(url.origin, next, "state");

  const { clientId, clientSecret, configured } = await discordConfig();
  if (!configured) return back(url.origin, next, "unconfigured");

  let user: { id: string; name: string };
  try {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${url.origin}/api/discord/callback`,
      }),
    });
    if (!tokenResponse.ok) {
      // Discord names the cause (invalid_client, invalid_grant, ...); passing it
      // through turns a dead end into something actionable.
      const detail = await tokenResponse.text().catch(() => "");
      const reason = /invalid_client/.test(detail) ? "badsecret"
        : /redirect_uri/.test(detail) ? "badredirect"
        : /invalid_grant/.test(detail) ? "badcode"
        : "exchange";
      return back(url.origin, next, reason);
    }
    const token = await tokenResponse.json() as TokenResponse;
    if (!token.access_token) return back(url.origin, next, "exchange");

    const userResponse = await fetch(USER_URL, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!userResponse.ok) return back(url.origin, next, "profile");
    const profile = await userResponse.json() as UserResponse;
    if (!profile.id || !profile.username) return back(url.origin, next, "profile");
    user = { id: profile.id, name: profile.global_name || profile.username };
  } catch {
    return back(url.origin, next, "network");
  }

  const target = new URL(`${url.origin}${next}`);
  target.searchParams.set("login", "ok");
  return new Response(null, {
    status: 302,
    headers: [
      ["location", target.toString()],
      ["set-cookie", clearState],
      ["set-cookie", cookieHeader(SESSION_COOKIE, await signUser(user), remember ? REMEMBER_SECONDS : null)],
    ],
  });
}
