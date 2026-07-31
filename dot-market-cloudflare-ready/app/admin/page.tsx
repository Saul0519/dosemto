import { requireChatGPTUser, platformSignOutPath } from "../chatgpt-auth";
import { isSuperAdmin, listManagedShops } from "../../db/shops";
import { listManagedOrders } from "../../db/orders";
import AdminPanel from "./panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireChatGPTUser("/admin");
  const shops = await listManagedShops(user.email);
  const [orders, superAdmin] = await Promise.all([
    listManagedOrders(user.email),
    isSuperAdmin(user.email),
  ]);
  return <AdminPanel userName={user.displayName} shops={shops} orders={orders} isSuperAdmin={superAdmin} signOutPath={await platformSignOutPath("/")}/>;
}
