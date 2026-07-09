// =============================================================================
// Cloudflare Access JWT verification. The Cloudflare Tunnel in front of this
// app enforces sign-in via a Zero Trust "Access" application before any
// request reaches us, and stamps every request with a signed JWT proving who
// authenticated (Cf-Access-Jwt-Assertion header, or a CF_Authorization cookie
// on subsequent requests). We verify that JWT ourselves — never just trust the
// header's presence — against Cloudflare's own public keys for our team,
// scoped to this specific Access application via its audience (AUD) tag.
//
// Requires env: CF_ACCESS_TEAM_DOMAIN (e.g. "yourteam.cloudflareaccess.com"),
// CF_ACCESS_AUD (this app's Access application AUD tag, from the Zero Trust
// dashboard). See .env.example.
// =============================================================================

import { createRemoteJWKSet, jwtVerify } from "jose";

const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
const aud = process.env.CF_ACCESS_AUD;

// Lazily created — createRemoteJWKSet caches Cloudflare's public keys and
// handles rotation internally, so one instance should live for the process.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  return jwks;
}

/** Verifies a Cf-Access-Jwt-Assertion token. Returns the authenticated email, or null if invalid/missing config. */
export async function verifyAccessJwt(token: string): Promise<string | null> {
  if (!teamDomain || !aud) {
    console.error("[cfAccess] CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD not set — cannot verify identity.");
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://${teamDomain}`,
      audience: aud,
    });
    if (typeof payload.email !== "string") {
      console.error("[cfAccess] token verified but payload has no string 'email' claim:", payload);
      return null;
    }
    return payload.email;
  } catch (err) {
    // Logged (never the token itself) — an AUD/issuer mismatch or an expired/
    // tampered token should be visible in server logs, not fail silently.
    console.error("[cfAccess] jwtVerify failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
