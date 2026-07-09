import { describe, it, expect, vi, beforeEach } from "vitest";

// cfAccess.ts reads CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD as module-level
// constants, so each test needs a fresh module instance (vi.resetModules) with
// its own env stubbed before importing — and `jose` mocked per-test via
// vi.doMock, since we're not making real network calls to fetch Cloudflare's
// JWKS.
describe("verifyAccessJwt", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns null when CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD aren't configured", async () => {
    vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", "");
    vi.stubEnv("CF_ACCESS_AUD", "");
    const { verifyAccessJwt } = await import("@/lib/server/cfAccess");
    expect(await verifyAccessJwt("sometoken")).toBeNull();
  });

  it("returns the verified email on a valid token", async () => {
    vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com");
    vi.stubEnv("CF_ACCESS_AUD", "aud123");
    vi.doMock("jose", () => ({
      createRemoteJWKSet: vi.fn(() => "jwks"),
      jwtVerify: vi.fn().mockResolvedValue({ payload: { email: "alice@example.com" } }),
    }));
    const { verifyAccessJwt } = await import("@/lib/server/cfAccess");
    expect(await verifyAccessJwt("goodtoken")).toBe("alice@example.com");
  });

  it("returns null when jwtVerify rejects (invalid, expired, or tampered token)", async () => {
    vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com");
    vi.stubEnv("CF_ACCESS_AUD", "aud123");
    vi.doMock("jose", () => ({
      createRemoteJWKSet: vi.fn(() => "jwks"),
      jwtVerify: vi.fn().mockRejectedValue(new Error("signature verification failed")),
    }));
    const { verifyAccessJwt } = await import("@/lib/server/cfAccess");
    expect(await verifyAccessJwt("badtoken")).toBeNull();
  });

  it("returns null when the verified payload has no email claim", async () => {
    vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com");
    vi.stubEnv("CF_ACCESS_AUD", "aud123");
    vi.doMock("jose", () => ({
      createRemoteJWKSet: vi.fn(() => "jwks"),
      jwtVerify: vi.fn().mockResolvedValue({ payload: {} }),
    }));
    const { verifyAccessJwt } = await import("@/lib/server/cfAccess");
    expect(await verifyAccessJwt("tok")).toBeNull();
  });
});
