import { notFound } from "next/navigation";
import PixelOrderStudio from "../../pixel-order-studio";
import { getPublicShop } from "../../../db/shops";
import { turnstileSiteKey } from "../../../db/turnstile";

export const dynamic = "force-dynamic";

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [shop, captchaSiteKey] = await Promise.all([getPublicShop(slug), turnstileSiteKey()]);
  if (!shop) notFound();
  return <PixelOrderStudio shop={shop} captchaSiteKey={captchaSiteKey}/>;
}
