/**
 * What roles a buyer holds in a given Discord server.
 *
 * Read once, when the purchase is made, and stored on the purchase — so the
 * record says what they had at the time rather than what they have today. The
 * whole thing is off unless a server id is set, and clearing that id turns it
 * off again without touching anything else.
 *
 * Everything here fails quietly. A missing bot, a server it was never invited
 * to, a buyer who left — none of those are the buyer's problem, and none of
 * them should stop a purchase going through.
 */

const API = "https://discord.com/api/v10";

const headers = (token: string) => ({
  authorization: `Bot ${token}`,
  "content-type": "application/json",
  "user-agent": "DotMarket (https://dosemto.store, 1.0)",
});

type RoleRow = { id: string; name: string; position: number };

/**
 * A server's role names, kept for the life of the isolate.
 *
 * Roles are renamed rarely and a stale name for a few minutes costs nothing,
 * whereas asking Discord on every purchase costs a round trip every time.
 */
const roleCache = new Map<string, { at: number; names: Map<string, RoleRow> }>();
const CACHE_MS = 10 * 60 * 1000;

async function guildRoles(guildId: string, token: string) {
  const cached = roleCache.get(guildId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.names;

  const response = await fetch(`${API}/guilds/${guildId}/roles`, { headers: headers(token) })
    .catch(() => null);
  if (!response?.ok) return null;
  const roles = await response.json().catch(() => null) as RoleRow[] | null;
  if (!Array.isArray(roles)) return null;

  const names = new Map(roles.map((role) => [role.id, role]));
  roleCache.set(guildId, { at: Date.now(), names });
  return names;
}

/**
 * Returns the buyer's role names, highest first, or null when there is nothing
 * to say — no server set, no bot, not a member.
 *
 * @everyone is left out: everyone has it, so printing it tells nobody anything.
 */
export async function rolesForMember(guildId: string, userId: string): Promise<string[] | null> {
  if (!guildId || !userId) return null;
  const { env } = await import("cloudflare:workers");
  const token = typeof env.DISCORD_BOT_TOKEN === "string" ? env.DISCORD_BOT_TOKEN.trim() : "";
  if (!token) return null;

  const member = await fetch(`${API}/guilds/${guildId}/members/${userId}`, { headers: headers(token) })
    .catch(() => null);
  // 404 is the ordinary case of someone who is not in that server.
  if (!member?.ok) return null;
  const body = await member.json().catch(() => null) as { roles?: string[] } | null;
  if (!Array.isArray(body?.roles)) return null;
  if (body.roles.length === 0) return [];

  const names = await guildRoles(guildId, token);
  if (!names) return null;

  return body.roles
    .map((id) => names.get(id))
    .filter((role): role is RoleRow => Boolean(role) && role!.id !== guildId)
    .sort((a, b) => b.position - a.position)
    .map((role) => role.name)
    .slice(0, 12);
}
