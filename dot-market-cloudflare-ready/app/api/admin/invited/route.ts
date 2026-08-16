import { cookieHeader, readCookie } from "../../../../db/discord-session";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getShopForManager, setShopGuild } from "../../../../db/shops";
import { INVITE_STATE_COOKIE } from "../invite/route";

export const dynamic = "force-dynamic";

/**
 * Where Discord lands after the manager adds the bot to a server. The useful
 * part is guild_id — it tells us which server to read the channel list from,
 * so nobody has to hunt for a channel id by hand.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const clear = cookieHeader(INVITE_STATE_COOKIE, "", 0);
  const done = (result: string) =>
    new Response(null, {
      status: 302,
      headers: { location: `${url.origin}/admin?invite=${result}`, "set-cookie": clear },
    });

  const [expectedState = "", shopId = ""] = (readCookie(request, INVITE_STATE_COOKIE) ?? "").split("|");
  const state = url.searchParams.get("state") ?? "";
  const guildId = url.searchParams.get("guild_id") ?? "";

  if (!expectedState || state !== expectedState || !shopId) return done("state");
  // Discord sends this, but it reaches us through the address bar, so it is
  // treated as something anyone could have typed.
  if (!/^\d{17,20}$/.test(guildId)) return done("noguild");

  const user = await getChatGPTUser();
  if (!user || !(await getShopForManager(shopId, user.email))) return done("forbidden");

  try {
    await setShopGuild(shopId, guildId);
  } catch {
    return done("save");
  }
  return done("ok");
}
