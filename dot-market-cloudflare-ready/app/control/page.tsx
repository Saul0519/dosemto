import { notFound } from "next/navigation";
import { requireChatGPTUser } from "../chatgpt-auth";
import { isSuperAdmin, listAllShops, listFeatureRanks } from "../../db/shops";
import { listAllReviews } from "../../db/reviews";
import { listApplications } from "../../db/applications";
import { discordConfig } from "../../db/discord-session";
import { getStoreChannelId, getStoreGuildId, listAllItems, listPurchases } from "../../db/store";
import { listAllReviews as listAllStoreReviews } from "../../db/store-reviews";
import { getPopupForOwner } from "../../db/popup";
import { readStats } from "../../db/stats";
import ControlPanel from "./panel";

export const dynamic = "force-dynamic";

export default async function ControlPage() {
  const user = await requireChatGPTUser("/control");
  if (!(await isSuperAdmin(user.email))) notFound();
  const [shops, reviews, applications, featureRanks, discord] = await Promise.all([
    listAllShops(),
    listAllReviews().catch(() => []),
    listApplications().catch(() => []),
    // Kept apart from the shop objects. This screen is the only place it is
    // ever sent to a browser, and only the site owner can open it.
    listFeatureRanks().catch(() => new Map<string, number>()),
    discordConfig().catch(() => ({ clientId: "" })),
  ]);

  const [storeItems, storePurchases, storeReviews, storeChannelId, storeGuildId, popup, stats] = await Promise.all([
    listAllItems().catch(() => []),
    listPurchases().catch(() => []),
    listAllStoreReviews().catch(() => []),
    getStoreChannelId().catch(() => ""),
    getStoreGuildId().catch(() => ""),
    getPopupForOwner().catch(() => ({ active: false, linkUrl: "", imageUrl: null, alt: "", version: "" })),
    readStats(7).catch(() => null),
  ]);

  /**
   * The bot only needs to be *present* in a server to DM its members — it needs
   * no permission to read or post. permissions=0 is the whole point: it makes
   * the ask something a server owner can say yes to.
   */
  const dmInviteUrl = discord.clientId
    ? `https://discord.com/oauth2/authorize?client_id=${discord.clientId}&permissions=0&scope=bot&integration_type=0`
    : "";
  return (
    <ControlPanel
      initialShops={shops}
      initialReviews={reviews}
      initialApplications={applications}
      initialFeatureRanks={Object.fromEntries(featureRanks)}
      dmInviteUrl={dmInviteUrl}
      storeItems={storeItems}
      storePurchases={storePurchases}
      storeReviews={storeReviews}
      storeChannelId={storeChannelId}
      storeGuildId={storeGuildId}
      popup={popup}
      stats={stats}
    />
  );
}
