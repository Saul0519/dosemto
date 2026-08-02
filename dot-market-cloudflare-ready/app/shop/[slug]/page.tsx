import { headers } from "next/headers";
import { notFound } from "next/navigation";
import PixelOrderStudio from "../../pixel-order-studio";
import { MC_SESSION_COOKIE, mcAuthConfig, verifyPlayer } from "../../../db/mc-session";
import { getPublicShop } from "../../../db/shops";
import { turnstileSiteKey } from "../../../db/turnstile";

export const dynamic = "force-dynamic";

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [shop, captchaSiteKey] = await Promise.all([getPublicShop(slug), turnstileSiteKey()]);
  if (!shop) notFound();

  // Ordering needs a verified Minecraft account; converting and downloading do not.
  const cookie = (await headers()).get("cookie") ?? "";
  const raw = cookie.split(";").map((part) => part.trim().split("="))
    .find(([key]) => key === MC_SESSION_COOKIE)?.slice(1).join("=");
  const player = await verifyPlayer(raw ? decodeURIComponent(raw) : null).catch(() => null);
  const { configured } = await mcAuthConfig();

  return (
    <PixelOrderStudio
      shop={shop}
      captchaSiteKey={captchaSiteKey}
      playerName={player?.name ?? null}
      loginConfigured={configured}
    />
  );
}
