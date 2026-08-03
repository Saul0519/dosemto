import { randomToken } from "../../../../db/order-actions";
import { cookieHeader, discordConfig } from "../../../../db/discord-session";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getShopForManager } from "../../../../db/shops";

export const dynamic = "force-dynamic";

export const INVITE_STATE_COOKIE = "dm_invite";

// Send messages + embed links + attach files. Nothing else: the bot never reads
// channel history and should not be able to.
const PERMISSIONS = "51200";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const shopId = url.searchParams.get("shop") ?? "";

  const user = await getChatGPTUser();
  if (!user) return Response.redirect(`${url.origin}/admin`, 302);
  if (!shopId || !(await getShopForManager(shopId, user.email))) {
    return Response.redirect(`${url.origin}/admin?invite=forbidden`, 302);
  }

  const { clientId, configured } = await discordConfig();
  if (!configured) return Response.redirect(`${url.origin}/admin?invite=unconfigured`, 302);

  // Ties the returning guild_id to the shop the manager started from, and stops
  // someone else's callback landing on this shop.
  const state = randomToken(24);

  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("permissions", PERMISSIONS);
  authorize.searchParams.set("scope", "bot");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("integration_type", "0");
  authorize.searchParams.set("redirect_uri", `${url.origin}/api/admin/invited`);
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      "set-cookie": cookieHeader(INVITE_STATE_COOKIE, `${state}|${shopId}`, 600),
    },
  });
}
