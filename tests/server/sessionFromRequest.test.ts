import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSessionToken, userIdFromSessionToken, userIdFromCookieHeader } from "@/lib/server/sessionFromRequest";

vi.mock("@/lib/prisma", () => ({
  prisma: { session: { findUnique: vi.fn() } },
}));

// Import after the mock so we get the mocked instance.
import { prisma } from "@/lib/prisma";
const findUnique = prisma.session.findUnique as unknown as ReturnType<typeof vi.fn>;

describe("parseSessionToken (pure)", () => {
  it("reads the dev (non-secure) Auth.js cookie", () => {
    expect(parseSessionToken("authjs.session-token=abc123")).toBe("abc123");
  });

  it("reads the secure-prefixed cookie when present", () => {
    expect(parseSessionToken("__Secure-authjs.session-token=xyz789")).toBe("xyz789");
  });

  it("prefers the secure cookie if both are somehow present", () => {
    const header = "__Secure-authjs.session-token=secure-val; authjs.session-token=plain-val";
    expect(parseSessionToken(header)).toBe("secure-val");
  });

  it("finds the token among other unrelated cookies", () => {
    const header = "foo=bar; authjs.session-token=abc123; other=1";
    expect(parseSessionToken(header)).toBe("abc123");
  });

  it("URL-decodes the token value", () => {
    expect(parseSessionToken("authjs.session-token=a%2Fb%3Dc")).toBe("a/b=c");
  });

  it("returns null when the cookie header is missing or empty", () => {
    expect(parseSessionToken(undefined)).toBeNull();
    expect(parseSessionToken(null)).toBeNull();
    expect(parseSessionToken("")).toBeNull();
  });

  it("returns null when no matching cookie is present", () => {
    expect(parseSessionToken("foo=bar; other=1")).toBeNull();
  });
});

describe("userIdFromSessionToken (Prisma-backed)", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("returns the userId for a valid, unexpired session", async () => {
    findUnique.mockResolvedValue({
      userId: "user-1",
      sessionToken: "tok",
      expires: new Date(Date.now() + 60_000),
    });
    expect(await userIdFromSessionToken("tok")).toBe("user-1");
  });

  it("returns null for an expired session", async () => {
    findUnique.mockResolvedValue({
      userId: "user-1",
      sessionToken: "tok",
      expires: new Date(Date.now() - 60_000),
    });
    expect(await userIdFromSessionToken("tok")).toBeNull();
  });

  it("returns null when no session row exists", async () => {
    findUnique.mockResolvedValue(null);
    expect(await userIdFromSessionToken("nope")).toBeNull();
  });
});

describe("userIdFromCookieHeader (composed)", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("resolves end-to-end from a raw cookie header", async () => {
    findUnique.mockResolvedValue({
      userId: "user-9",
      sessionToken: "tok9",
      expires: new Date(Date.now() + 60_000),
    });
    expect(await userIdFromCookieHeader("authjs.session-token=tok9")).toBe("user-9");
  });

  it("never calls Prisma when there is no cookie at all", async () => {
    expect(await userIdFromCookieHeader(undefined)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
