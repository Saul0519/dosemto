import { notFound } from "next/navigation";
import { requireChatGPTUser } from "../chatgpt-auth";
import { isSuperAdmin, listAllShops } from "../../db/shops";
import { listAllReviews } from "../../db/reviews";
import ControlPanel from "./panel";

export const dynamic = "force-dynamic";

export default async function ControlPage() {
  const user = await requireChatGPTUser("/control");
  if (!(await isSuperAdmin(user.email))) notFound();
  const [shops, reviews] = await Promise.all([
    listAllShops(),
    listAllReviews().catch(() => []),
  ]);
  return <ControlPanel initialShops={shops} initialReviews={reviews}/>;
}
