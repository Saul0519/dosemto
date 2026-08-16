import { countView } from "../../../../db/stats";
import { tooMany } from "../../../../db/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Counts one page view.
 *
 * Called from the browser after the page is up rather than during the render,
 * so it costs the reader nothing and crawlers that do not run scripts stay out
 * of the numbers. Nothing about the caller is stored — the row is a day, a page
 * kind, and a tally.
 */
export async function POST(request: Request) {
  // Anyone can call this, so it is capped: the figures are only worth having
  // if one script cannot invent them.
  if (await tooMany(request, "view")) return Response.json({ ok: false });

  const body = await request.json().catch(() => null) as { event?: unknown } | null;
  const counted = await countView(String(body?.event ?? "")).catch(() => false);
  // Never a hard failure: a missed count is not worth an error in the console.
  return Response.json({ ok: counted });
}
