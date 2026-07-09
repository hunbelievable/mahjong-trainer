// =============================================================================
// Resolves the Cloudflare-Access-authenticated userId for a RAW HTTP/WS
// request — server.ts's own request handling (roomApi.ts, the WS upgrade)
// never passes through Next's request lifecycle, so `headers()`/`cookies()`
// (used by currentUser.ts, for Server Components) aren't available; this
// reads the same identity directly off the raw IncomingMessage instead.
// =============================================================================

import type { IncomingMessage } from "node:http";
import { prisma } from "@/lib/prisma";
import { verifyAccessJwt } from "./cfAccess";

const ACCESS_COOKIE_NAME = "CF_Authorization";

/** Pure — no I/O. Extracts a named cookie's value from a raw `Cookie` header. */
export function parseCookie(cookieHeader: string | undefined | null, name: string): string | null {
  if (!cookieHeader) return null;
  const prefix = `${name}=`;
  const hit = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : null;
}

/** Verifies an Access token and finds-or-creates the User row for its email. Null if the token is missing/invalid. */
export async function resolveUserFromToken(token: string | null): Promise<{ id: string; email: string } | null> {
  if (!token) return null;
  const email = await verifyAccessJwt(token);
  if (!email) return null;
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true, email: true },
  });
}

/** Convenience: resolve a userId directly from a raw request (WS upgrade or plain Node handler). */
export async function userIdFromRequest(req: IncomingMessage): Promise<string | null> {
  const headerValue = req.headers["cf-access-jwt-assertion"];
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const token = headerToken ?? parseCookie(req.headers.cookie, ACCESS_COOKIE_NAME);
  const user = await resolveUserFromToken(token ?? null);
  return user?.id ?? null;
}
