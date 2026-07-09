import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/server/currentUser", () => ({
  currentUser: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { update: vi.fn() } },
}));

import { PATCH } from "@/app/api/user/route";
import { currentUser } from "@/lib/server/currentUser";
import { prisma } from "@/lib/prisma";

const mockCurrentUser = currentUser as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.user.update as unknown as ReturnType<typeof vi.fn>;

function req(body: unknown): Request {
  return new Request("http://localhost/api/user", { method: "PATCH", body: JSON.stringify(body) });
}

describe("PATCH /api/user", () => {
  beforeEach(() => {
    mockCurrentUser.mockReset();
    mockUpdate.mockReset();
  });

  it("requires auth", async () => {
    mockCurrentUser.mockResolvedValue(null);
    const res = await PATCH(req({ handle: "Rusty" }));
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("trims, caps at 24 chars, and saves the handle", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user-1", email: "a@b.com", handle: null });
    mockUpdate.mockResolvedValue({});
    const res = await PATCH(req({ handle: "  " + "x".repeat(30) + "  " }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handle).toBe("x".repeat(24));
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { handle: "x".repeat(24) } });
  });

  it("treats an empty/whitespace-only handle as clearing it", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user-1", email: "a@b.com", handle: "Old" });
    mockUpdate.mockResolvedValue({});
    const res = await PATCH(req({ handle: "   " }));
    const body = await res.json();
    expect(body.handle).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { handle: null } });
  });

  it("rejects a non-string handle", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user-1", email: "a@b.com", handle: null });
    const res = await PATCH(req({ handle: 42 }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user-1", email: "a@b.com", handle: null });
    const badReq = new Request("http://localhost/api/user", { method: "PATCH", body: "not json" });
    const res = await PATCH(badReq);
    expect(res.status).toBe(400);
  });
});
