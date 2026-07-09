import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "node:http";
import { parseCookie, resolveUserFromToken, userIdFromRequest } from "@/lib/server/accessIdentity";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { upsert: vi.fn() } },
}));
vi.mock("@/lib/server/cfAccess", () => ({
  verifyAccessJwt: vi.fn(),
}));

// Import after the mocks so we get the mocked instances.
import { prisma } from "@/lib/prisma";
import { verifyAccessJwt } from "@/lib/server/cfAccess";

const upsert = prisma.user.upsert as unknown as ReturnType<typeof vi.fn>;
const verify = verifyAccessJwt as unknown as ReturnType<typeof vi.fn>;

function fakeRequest(headers: Record<string, string>): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("parseCookie (pure)", () => {
  it("reads the named cookie among others", () => {
    expect(parseCookie("foo=bar; CF_Authorization=tok123; other=1", "CF_Authorization")).toBe("tok123");
  });

  it("URL-decodes the value", () => {
    expect(parseCookie("CF_Authorization=a%2Fb%3Dc", "CF_Authorization")).toBe("a/b=c");
  });

  it("returns null when the header is missing or the cookie isn't present", () => {
    expect(parseCookie(undefined, "CF_Authorization")).toBeNull();
    expect(parseCookie(null, "CF_Authorization")).toBeNull();
    expect(parseCookie("foo=bar", "CF_Authorization")).toBeNull();
  });
});

describe("resolveUserFromToken", () => {
  beforeEach(() => {
    upsert.mockReset();
    verify.mockReset();
  });

  it("returns null without calling Prisma when there's no token", async () => {
    expect(await resolveUserFromToken(null)).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns null when the token fails verification", async () => {
    verify.mockResolvedValue(null);
    expect(await resolveUserFromToken("bad-token")).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("finds-or-creates a User row keyed by the verified email", async () => {
    verify.mockResolvedValue("alice@example.com");
    upsert.mockResolvedValue({ id: "user-1", email: "alice@example.com" });

    const user = await resolveUserFromToken("good-token");

    expect(user).toEqual({ id: "user-1", email: "alice@example.com" });
    expect(upsert).toHaveBeenCalledWith({
      where: { email: "alice@example.com" },
      update: {},
      create: { email: "alice@example.com" },
      select: { id: true, email: true },
    });
  });
});

describe("userIdFromRequest", () => {
  beforeEach(() => {
    upsert.mockReset();
    verify.mockReset();
  });

  it("prefers the Cf-Access-Jwt-Assertion header over the CF_Authorization cookie", async () => {
    verify.mockResolvedValue("bob@example.com");
    upsert.mockResolvedValue({ id: "user-2", email: "bob@example.com" });

    const req = fakeRequest({ "cf-access-jwt-assertion": "header-token", cookie: "CF_Authorization=cookie-token" });
    expect(await userIdFromRequest(req)).toBe("user-2");
    expect(verify).toHaveBeenCalledWith("header-token");
  });

  it("falls back to the CF_Authorization cookie when there's no header", async () => {
    verify.mockResolvedValue("carol@example.com");
    upsert.mockResolvedValue({ id: "user-3", email: "carol@example.com" });

    const req = fakeRequest({ cookie: "CF_Authorization=cookie-token" });
    expect(await userIdFromRequest(req)).toBe("user-3");
    expect(verify).toHaveBeenCalledWith("cookie-token");
  });

  it("returns null when neither the header nor the cookie is present", async () => {
    const req = fakeRequest({});
    expect(await userIdFromRequest(req)).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });
});
