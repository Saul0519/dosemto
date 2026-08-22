/** Cloudflare Worker entry point for DOT MARKET's vinext application. */
import { handleInteraction } from "./discord-interactions";
import { harden } from "./security-headers";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  SUPER_ADMIN_EMAIL: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  WEBHOOK_ENCRYPTION_KEY: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  OWNER_DISCORD_ID: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * The web application, brought in only when a request actually needs it.
 *
 * It is a megabyte of bundle, and a worker that has gone cold has to evaluate
 * every line of it before its `fetch` can run. That is fine for a page — the
 * reader waits a moment longer. It is not fine for a Discord button: Discord
 * allows three seconds from press to reply, gives up after that, and shows
 * "응답하지 않았어요" to whoever pressed.
 *
 * So the button path never touches this. Cold, it evaluates the twenty-odd
 * kilobytes it genuinely needs — signature check, permission bits, one write —
 * and answers. Once loaded the module stays loaded, so a page pays this on the
 * first request of a cold isolate and never again.
 */
let app: { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> } | null = null;

async function application() {
  if (!app) app = (await import("vinext/server/app-router-entry")).default;
  return app;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Discord expects a reply within three seconds and drops an endpoint whose
    // signature check ever misbehaves, so this one is answered here rather than
    // through the app router. It also needs ctx.waitUntil, which the framework
    // does not hand down.
    const { pathname } = new URL(request.url);
    if (pathname === "/api/discord/interactions" && request.method === "POST") {
      // Discord reads the body and the status, not the headers; leaving this
      // one alone keeps the three-second reply as tight as possible.
      return handleInteraction(request, env, ctx);
    }
    // Everything the browser is ever handed goes through here, so no page can
    // be served without the protections on it.
    const handler = await application();
    return harden(await handler.fetch(request, env, ctx), pathname);
  },
};

export default worker;
