/** Cloudflare Worker entry point for DOT MARKET's vinext application. */
import handler from "vinext/server/app-router-entry";
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
    return harden(await handler.fetch(request, env, ctx), pathname);
  },
};

export default worker;
