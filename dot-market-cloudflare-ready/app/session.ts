import { headers } from "next/headers";
import { SESSION_COOKIE, verifyUser, type DiscordUser } from "../db/discord-session";

/** Reads the signed-in Discord user inside a server component. */
export async function getUser(): Promise<DiscordUser | null> {
  const cookie = (await headers()).get("cookie") ?? "";
  const raw = cookie.split(";").map((part) => part.trim().split("="))
    .find(([key]) => key === SESSION_COOKIE)?.slice(1).join("=");
  if (!raw) return null;
  return verifyUser(decodeURIComponent(raw)).catch(() => null);
}
