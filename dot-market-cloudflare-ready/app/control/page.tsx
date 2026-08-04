import { notFound } from "next/navigation";
import { requireChatGPTUser } from "../chatgpt-auth";
import { isSuperAdmin, listAllShops, listFeatureRanks } from "../../db/shops";
import { listAllReviews } from "../../db/reviews";
import { listApplications } from "../../db/applications";
import ControlPanel from "./panel";

export const dynamic = "force-dynamic";

export default async function ControlPage() {
  const user = await requireChatGPTUser("/control");
  if (!(await isSuperAdmin(user.email))) notFound();
  const [shops, reviews, applications, featureRanks] = await Promise.all([
    listAllShops(),
    listAllReviews().catch(() => []),
    listApplications().catch(() => []),
    // Kept apart from the shop objects. This screen is the only place it is
    // ever sent to a browser, and only the site owner can open it.
    listFeatureRanks().catch(() => new Map<string, number>()),
  ]);
  return (
    <ControlPanel
      initialShops={shops}
      initialReviews={reviews}
      initialApplications={applications}
      initialFeatureRanks={Object.fromEntries(featureRanks)}
    />
  );
}
