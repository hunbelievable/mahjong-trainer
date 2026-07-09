// Server Component helper: the Cloudflare-Access-authenticated user for the
// current request, or null. This is the identity the RoomManager / gateway
// use to authorize seat actions — see lib/server/accessIdentity.ts for the
// raw-request (WS/roomApi) equivalent.
import { headers, cookies } from "next/headers";
import { resolveUserFromToken } from "./accessIdentity";

function currentAccessToken(): string | null {
  return headers().get("cf-access-jwt-assertion") ?? cookies().get("CF_Authorization")?.value ?? null;
}

export async function currentUser(): Promise<{ id: string; email: string; handle: string | null } | null> {
  return resolveUserFromToken(currentAccessToken());
}

export async function currentUserId(): Promise<string | null> {
  const user = await currentUser();
  return user?.id ?? null;
}
