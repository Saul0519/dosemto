import { notFound } from "next/navigation";
import { requireChatGPTUser } from "../chatgpt-auth";
import { isSuperAdmin, listAllShops } from "../../db/shops";
import ControlPanel from "./panel";

export const dynamic = "force-dynamic";

export default async function ControlPage() {
  const user = await requireChatGPTUser("/control");
  if (!(await isSuperAdmin(user.email))) notFound();
  return <ControlPanel initialShops={await listAllShops()}/>;
}
