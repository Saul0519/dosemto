import { getChatGPTUser } from "../../../../../chatgpt-auth";
import { getShopForManager } from "../../../../../../db/shops";
import { guildChannels } from "../../../../../../db/discord-bot";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 });

  const { id } = await context.params;
  const shop = await getShopForManager(id, user.email);
  if (!shop) return Response.json({ error: "이 샵을 관리할 권한이 없습니다." }, { status: 403 });
  if (!shop.guildId) return Response.json({ ok: true, channels: [], needsInvite: true });

  const channels = await guildChannels(shop.guildId);
  // Usually the bot was kicked, or never finished joining.
  if (!channels) return Response.json({ ok: true, channels: [], needsInvite: true });

  return Response.json({ ok: true, channels, needsInvite: false });
}
