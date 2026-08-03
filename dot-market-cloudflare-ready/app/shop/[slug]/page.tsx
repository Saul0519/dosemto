import { notFound } from "next/navigation";
import PixelOrderStudio from "../../pixel-order-studio";
import { discordConfig } from "../../../db/discord-session";
import { getUser } from "../../session";
import { countActiveOrders } from "../../../db/orders";
import { getPublicShop } from "../../../db/shops";
import { slotState } from "../../../db/slots";
import { turnstileSiteKey } from "../../../db/turnstile";

export const dynamic = "force-dynamic";

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [shop, captchaSiteKey] = await Promise.all([getPublicShop(slug), turnstileSiteKey()]);
  if (!shop) notFound();

  // Ordering needs a signed-in Discord account; converting and downloading do not.
  const user = await getUser().catch(() => null);
  const { configured } = await discordConfig();
  const slots = slotState(shop, await countActiveOrders(shop.id).catch(() => 0));

  return (
    <PixelOrderStudio
      shop={shop}
      captchaSiteKey={captchaSiteKey}
      userName={user?.name ?? null}
      loginConfigured={configured}
      slots={{ enabled: slots.enabled, used: slots.used, max: slots.max, full: slots.full }}
    />
  );
}
