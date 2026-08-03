import { notFound } from "next/navigation";
import PixelOrderStudio from "../../pixel-order-studio";
import { discordConfig } from "../../../db/discord-session";
import { getUser } from "../../session";
import { getPublicShop } from "../../../db/shops";
import { turnstileSiteKey } from "../../../db/turnstile";

export const dynamic = "force-dynamic";

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [shop, captchaSiteKey] = await Promise.all([getPublicShop(slug), turnstileSiteKey()]);
  if (!shop) notFound();

  // Ordering needs a signed-in Discord account; converting and downloading do not.
  const user = await getUser().catch(() => null);
  const { configured } = await discordConfig();

  return (
    <PixelOrderStudio
      shop={shop}
      captchaSiteKey={captchaSiteKey}
      userName={user?.name ?? null}
      loginConfigured={configured}
    />
  );
}
