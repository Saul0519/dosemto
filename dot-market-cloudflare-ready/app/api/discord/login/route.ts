import { randomToken } from "../../../../db/random-token";
import {
  STATE_COOKIE,
  cookieHeader,
  discordConfig,
  safeNextPath,
} from "../../../../db/discord-session";

export const dynamic = "force-dynamic";

const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const remember = url.searchParams.get("remember") === "1";

  const { clientId, configured } = await discordConfig();
  if (!configured) {
    return Response.redirect(`${url.origin}${next}?login=unconfigured`, 302);
  }

  // Echoed back by Discord and compared against the cookie, so a third party
  // cannot feed us an authorization code of their own.
  const state = randomToken(24);

  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", `${url.origin}/api/discord/callback`);
  authorize.searchParams.set("response_type", "code");
  // identify is all we need: the snowflake and a display name.
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("prompt", "none");

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      // Carries the return path and the remember choice, so the callback need
      // not trust anything in the query string.
      "set-cookie": cookieHeader(STATE_COOKIE, `${state}|${remember ? "1" : "0"}|${next}`, 600),
    },
  });
}
