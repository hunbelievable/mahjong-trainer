import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { handleRoomApi } from "@/lib/server/roomApi";
import { roomManager } from "@/lib/server/roomManager";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { upsert: vi.fn() } },
}));
vi.mock("@/lib/server/cfAccess", () => ({
  verifyAccessJwt: vi.fn(),
}));
import { prisma } from "@/lib/prisma";
import { verifyAccessJwt } from "@/lib/server/cfAccess";
const upsert = prisma.user.upsert as unknown as ReturnType<typeof vi.fn>;
const verify = verifyAccessJwt as unknown as ReturnType<typeof vi.fn>;

const TOKEN = "test-token";
const USER_ID = "user-1";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // A REAL http server wrapping the handler — exercises actual request/response
  // streaming rather than hand-rolled mocks, and is what actually caught the
  // production bug this file guards against.
  server = createServer((req, res) => {
    void handleRoomApi(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  verify.mockReset();
  upsert.mockReset();
  verify.mockResolvedValue("alice@example.com");
  upsert.mockResolvedValue({ id: USER_ID, email: "alice@example.com" });
});

function authedFetch(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), "Cf-Access-Jwt-Assertion": TOKEN },
  });
}

describe("handleRoomApi", () => {
  it("returns false and writes nothing for paths outside /api/rooms — caller must fall through", async () => {
    const req = { url: "/multiplayer", headers: {}, method: "GET" } as never;
    const res = { writeHead: vi.fn(), end: vi.fn() } as never;
    const handled = await handleRoomApi(req, res);
    expect(handled).toBe(false);
    expect((res as { writeHead: ReturnType<typeof vi.fn> }).writeHead).not.toHaveBeenCalled();
    expect((res as { end: ReturnType<typeof vi.fn> }).end).not.toHaveBeenCalled();
  });

  it("POST /api/rooms requires auth", async () => {
    verify.mockResolvedValue(null); // Access JWT fails verification
    const res = await authedFetch("/api/rooms", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("creates a room that is IMMEDIATELY visible to a separate, direct import of roomManager — the exact invariant that broke in production", async () => {
    const res = await authedFetch("/api/rooms", { method: "POST" });
    expect(res.status).toBe(200);
    const { roomId } = await res.json();
    expect(roomId).toMatch(/^[A-Z2-9]{6}$/);

    // Simulates what server.ts's WS handler does: import roomManager directly,
    // independent of the HTTP request path above.
    const room = roomManager.getRoom(roomId);
    expect(room).toBeDefined();
  });

  it("GET /api/rooms lists a newly created room as open", async () => {
    const createRes = await authedFetch("/api/rooms", { method: "POST" });
    const { roomId } = await createRes.json();

    const res = await authedFetch("/api/rooms");
    expect(res.status).toBe(200);
    const { rooms } = await res.json();
    const room = rooms.find((r: { roomId: string }) => r.roomId === roomId);
    expect(room).toMatchObject({ roomId, seatsHuman: 0, seatsOpen: 4 });
  });

  it("GET /api/rooms requires auth", async () => {
    verify.mockResolvedValue(null);
    const res = await authedFetch("/api/rooms");
    expect(res.status).toBe(401);
  });

  it("GET /api/rooms/:id returns the lobby view", async () => {
    const createRes = await authedFetch("/api/rooms", { method: "POST" });
    const { roomId } = await createRes.json();

    const res = await authedFetch(`/api/rooms/${roomId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ type: "lobby", view: { roomId, yourSeat: null } });
  });

  it("GET /api/rooms/:id 404s for an unknown room", async () => {
    const res = await authedFetch("/api/rooms/NOSUCH");
    expect(res.status).toBe(404);
  });

  it("claimSeat via actions is reflected in a follow-up GET", async () => {
    const createRes = await authedFetch("/api/rooms", { method: "POST" });
    const { roomId } = await createRes.json();

    const actionRes = await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claimSeat", seat: "E" }),
    });
    expect(actionRes.status).toBe(200);

    const viewRes = await authedFetch(`/api/rooms/${roomId}`);
    const body = await viewRes.json();
    expect(body.view.yourSeat).toBe("E");
  });

  it("claimSeat carries the caller's current handle into the lobby view", async () => {
    upsert.mockResolvedValue({ id: USER_ID, email: "alice@example.com", handle: "Alice" });
    const createRes = await authedFetch("/api/rooms", { method: "POST" });
    const { roomId } = await createRes.json();

    await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claimSeat", seat: "E" }),
    });

    const viewRes = await authedFetch(`/api/rooms/${roomId}`);
    const body = await viewRes.json();
    expect(body.view.seats.find((s: { seat: string }) => s.seat === "E")).toMatchObject({ handle: "Alice" });
  });

  it("start is creator-only — a seated non-creator gets 409, the creator succeeds", async () => {
    // alice creates and seats herself
    const createRes = await authedFetch("/api/rooms", { method: "POST" });
    const { roomId } = await createRes.json();
    await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claimSeat", seat: "E" }),
    });

    // bob seats himself too, then tries to start — not the creator
    verify.mockResolvedValue("bob@example.com");
    upsert.mockResolvedValue({ id: "user-2", email: "bob@example.com" });
    await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claimSeat", seat: "S" }),
    });
    const bobStart = await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    expect(bobStart.status).toBe(409);

    // alice (the creator) can
    verify.mockResolvedValue("alice@example.com");
    upsert.mockResolvedValue({ id: USER_ID, email: "alice@example.com" });
    const aliceStart = await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    expect(aliceStart.status).toBe(200);
  });

  it("setCpu is creator-only — a seated non-creator gets 409, the creator succeeds", async () => {
    const createRes = await authedFetch("/api/rooms", { method: "POST" });
    const { roomId } = await createRes.json();
    await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claimSeat", seat: "E" }),
    });

    verify.mockResolvedValue("bob@example.com");
    upsert.mockResolvedValue({ id: "user-2", email: "bob@example.com" });
    const bobSetCpu = await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setCpu", seat: "S", difficulty: "advanced" }),
    });
    expect(bobSetCpu.status).toBe(409);

    verify.mockResolvedValue("alice@example.com");
    upsert.mockResolvedValue({ id: USER_ID, email: "alice@example.com" });
    const aliceSetCpu = await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setCpu", seat: "S", difficulty: "advanced" }),
    });
    expect(aliceSetCpu.status).toBe(200);
  });

  it("rejects an unknown action with 400", async () => {
    const createRes = await authedFetch("/api/rooms", { method: "POST" });
    const { roomId } = await createRes.json();
    const res = await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when an action fails (seat already taken by another user)", async () => {
    const createRes = await authedFetch("/api/rooms", { method: "POST" });
    const { roomId } = await createRes.json();
    await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claimSeat", seat: "E" }),
    });

    verify.mockResolvedValue("bob@example.com");
    upsert.mockResolvedValue({ id: "user-2", email: "bob@example.com" });
    const res = await authedFetch(`/api/rooms/${roomId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claimSeat", seat: "E" }),
    });
    expect(res.status).toBe(409);
  });
});
