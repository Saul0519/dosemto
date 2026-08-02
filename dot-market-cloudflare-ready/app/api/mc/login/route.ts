import { randomToken } from "../../../../db/order-actions";
import {
  MC_STATE_COOKIE,
  cookieHeader,
  mcAuthConfig,
  safeNextPath,
} from "../../../../db/mc-session";

export const dynamic = "force-dynamic";

const AUTHORIZE_URL = "https://mc-auth.com/oAuth2/authorize";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const remember = url.searchParams.get("remember") === "1";

  const { clientId, configured } = await mcAuthConfig();
  if (!configured) {
    return Response.redirect(`${url.origin}${next}?mc=unconfigured`, 302);
  }

  // The state is echoed back by Mc-Auth and compared against the cookie, which
  // is what stops a third party from feeding us their own authorization code.
  const state = randomToken(24);
  const redirectUri = `${url.origin}/api/mc/callback`;

  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "profile");
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      // The state cookie also carries the return path and the remember choice,
      // so the callback does not have to trust anything in the query string.
      "set-cookie": cookieHeader(MC_STATE_COOKIE, `${state}|${remember ? "1" : "0"}|${next}`, 600),
    },
  });
}
