import { getChatGPTUser } from "../../../../../chatgpt-auth";
import { getShopForManager } from "../../../../../../db/shops";
import { botToken } from "../../../../../../db/discord-bot";

export const dynamic = "force-dynamic";

/** Text (0) and announcement (5) channels are the only ones we can post in. */
const POSTABLE = new Set([0, 5]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 });

  const { id } = await context.params;
  const shop = await getShopForManager(id, user.email);
  if (!shop) return Response.json({ error: "이 샵을 관리할 권한이 없습니다." }, { status: 403 });
  if (!shop.guildId) return Response.json({ ok: true, channels: [], needsInvite: true });

  const token = await botToken();
  if (!token) return Response.json({ error: "봇 토큰이 설정되지 않았습니다." }, { status: 503 });

  const response = await fetch(`https://discord.com/api/v10/guilds/${shop.guildId}/channels`, {
    headers: { authorization: `Bot ${token}`, "user-agent": "DotMarket (https://dosemto.store, 1.0)" },
  }).catch(() => null);

  if (!response?.ok) {
    // Usually the bot was kicked, or never finished joining.
    return Response.json({ ok: true, channels: [], needsInvite: true });
  }

  const all = await response.json().catch(() => []) as { id: string; name: string; type: number; position?: number }[];
  const channels = all
    .filter((channel) => POSTABLE.has(channel.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((channel) => ({ id: channel.id, name: channel.name }));

  return Response.json({ ok: true, channels, needsInvite: false });
}
