/** Cloudflare Worker entry point for DOT MARKET's vinext application. */
import handler from "vinext/server/app-router-entry";
import { handleInteraction } from "./discord-interactions";

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
      return handleInteraction(request, env, ctx);
    }
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
