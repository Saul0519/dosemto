import { headers } from "next/headers";
import { MC_SESSION_COOKIE, verifyPlayer, type McPlayer } from "../db/mc-session";

/** Reads the signed-in Minecraft player inside a server component. */
export async function getPlayer(): Promise<McPlayer | null> {
  const cookie = (await headers()).get("cookie") ?? "";
  const raw = cookie.split(";").map((part) => part.trim().split("="))
    .find(([key]) => key === MC_SESSION_COOKIE)?.slice(1).join("=");
  if (!raw) return null;
  return verifyPlayer(decodeURIComponent(raw)).catch(() => null);
}
