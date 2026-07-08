// =============================================================================
// Resolves the authenticated userId for a RAW HTTP request — specifically the
// WebSocket upgrade request, which never passes through Next's request
// lifecycle, so Auth.js's `auth()` (used by currentUser.ts) isn't available.
// This mirrors Auth.js's own "database" session-strategy validation: read the
// session cookie, look up the Session row, and check it hasn't expired.
// =============================================================================

import { prisma } from "@/lib/prisma";

// Auth.js v5 cookie names (confirmed from @auth/core/lib/utils/cookie.js):
// secure (https) deployments get the "__Secure-" prefix, dev/http does not.
const COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];

/** Pure — no I/O. Extracts the session token from a raw `Cookie` header value. */
export function parseSessionToken(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(";").map((p) => p.trim());
  for (const name of COOKIE_NAMES) {
    const prefix = `${name}=`;
    const hit = pairs.find((p) => p.startsWith(prefix));
    if (hit) return decodeURIComponent(hit.slice(prefix.length));
  }
  return null;
}

/** Looks up the Auth.js database session for a token. Null if missing or expired. */
export async function userIdFromSessionToken(token: string): Promise<string | null> {
  const session = await prisma.session.findUnique({ where: { sessionToken: token } });
  if (!session || session.expires < new Date()) return null;
  return session.userId;
}

/** Convenience: resolve a userId directly from a raw `Cookie` header. */
export async function userIdFromCookieHeader(
  cookieHeader: string | undefined | null,
): Promise<string | null> {
  const token = parseSessionToken(cookieHeader);
  return token ? userIdFromSessionToken(token) : null;
}
