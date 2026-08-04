import { notFound } from "next/navigation";
import { requireChatGPTUser } from "../chatgpt-auth";
import { isSuperAdmin, listAllShops } from "../../db/shops";
import { listAllReviews } from "../../db/reviews";
import { listApplications } from "../../db/applications";
import ControlPanel from "./panel";

export const dynamic = "force-dynamic";

export default async function ControlPage() {
  const user = await requireChatGPTUser("/control");
  if (!(await isSuperAdmin(user.email))) notFound();
  const [shops, reviews, applications] = await Promise.all([
    listAllShops(),
    listAllReviews().catch(() => []),
    listApplications().catch(() => []),
  ]);
  return (
    <ControlPanel
      initialShops={shops}
      initialReviews={reviews}
      initialApplications={applications}
    />
  );
}
