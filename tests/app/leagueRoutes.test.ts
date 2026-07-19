import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/server/currentUser", () => ({
  currentUser: vi.fn(),
}));
vi.mock("@/lib/server/league", () => ({
  listMyLeagues: vi.fn(),
  createLeague: vi.fn(),
  getLeagueDetail: vi.fn(),
  isLeagueMember: vi.fn(),
  addMember: vi.fn(),
  createSeason: vi.fn(),
  seasonLeagueId: vi.fn(),
  sessionLeagueId: vi.fn(),
  getSeasonDetail: vi.fn(),
  startSession: vi.fn(),
  getSeasonStandings: vi.fn(),
  getSessionScores: vi.fn(),
  enterScores: vi.fn(),
  linkRoomToSession: vi.fn(),
  getLinkedRooms: vi.fn(),
  syncSessionScoresFromRooms: vi.fn(),
  getPlayerHistory: vi.fn(),
}));

import { currentUser } from "@/lib/server/currentUser";
import * as league from "@/lib/server/league";
import { GET as listLeagues, POST as createLeagueRoute } from "@/app/api/leagues/route";
import { GET as leagueDetailRoute } from "@/app/api/leagues/[id]/route";
import { POST as addMemberRoute } from "@/app/api/leagues/[id]/members/route";
import { POST as createSeasonRoute } from "@/app/api/leagues/[id]/seasons/route";
import { GET as seasonDetailRoute } from "@/app/api/leagues/seasons/[seasonId]/route";
import { POST as startSessionRoute } from "@/app/api/leagues/seasons/[seasonId]/sessions/route";
import { GET as standingsRoute } from "@/app/api/leagues/seasons/[seasonId]/standings/route";
import { GET as scoresGetRoute, POST as scoresPostRoute } from "@/app/api/leagues/sessions/[sessionId]/scores/route";
import { GET as roomsGetRoute, POST as roomsPostRoute } from "@/app/api/leagues/sessions/[sessionId]/rooms/route";
import { POST as syncRoute } from "@/app/api/leagues/sessions/[sessionId]/sync/route";
import { GET as playerHistoryRoute } from "@/app/api/leagues/[id]/players/[userId]/route";

const mockCurrentUser = currentUser as unknown as ReturnType<typeof vi.fn>;

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}
function emptyReq(): Request {
  return new Request("http://localhost/x", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET/POST /api/leagues", () => {
  it("both require auth", async () => {
    mockCurrentUser.mockResolvedValue(null);
    expect((await listLeagues()).status).toBe(401);
    expect((await createLeagueRoute(jsonReq({ name: "x" }))).status).toBe(401);
  });

  it("GET lists the caller's leagues", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.listMyLeagues).mockResolvedValue([
      { id: "l1", name: "A", role: "commissioner", memberCount: 1 },
    ]);
    const res = await listLeagues();
    expect(res.status).toBe(200);
    expect((await res.json()).leagues).toHaveLength(1);
  });

  it("POST rejects a blank name and creates otherwise", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    expect((await createLeagueRoute(jsonReq({ name: "   " }))).status).toBe(400);

    vi.mocked(league.createLeague).mockResolvedValue({ id: "l1" });
    const res = await createLeagueRoute(jsonReq({ name: "Tuesday Night" }));
    expect(res.status).toBe(200);
    expect((await res.json()).leagueId).toBe("l1");
    expect(league.createLeague).toHaveBeenCalledWith("user1", "Tuesday Night");
  });
});

describe("GET /api/leagues/:id", () => {
  it("403s a non-member, 200s a member", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.isLeagueMember).mockResolvedValueOnce(false);
    expect((await leagueDetailRoute(new Request("http://localhost/x"), { params: { id: "l1" } })).status).toBe(403);

    vi.mocked(league.isLeagueMember).mockResolvedValueOnce(true);
    vi.mocked(league.getLeagueDetail).mockResolvedValue({
      id: "l1",
      name: "A",
      commissionerUserId: "user1",
      members: [],
      seasons: [],
    });
    const res = await leagueDetailRoute(new Request("http://localhost/x"), { params: { id: "l1" } });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/leagues/:id/members", () => {
  it("maps a false result (not commissioner, or already a member) to 409", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.addMember).mockResolvedValue(false);
    const res = await addMemberRoute(jsonReq({ email: "a@b.com" }), { params: { id: "l1" } });
    expect(res.status).toBe(409);
  });

  it("succeeds and lowercases/trims the email", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.addMember).mockResolvedValue(true);
    const res = await addMemberRoute(jsonReq({ email: "  Alice@Example.com  " }), { params: { id: "l1" } });
    expect(res.status).toBe(200);
    expect(league.addMember).toHaveBeenCalledWith("l1", "user1", "alice@example.com");
  });
});

describe("POST /api/leagues/:id/seasons", () => {
  it("maps a null result (not commissioner) to 403", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.createSeason).mockResolvedValue(null);
    const res = await createSeasonRoute(jsonReq({ name: "Fall" }), { params: { id: "l1" } });
    expect(res.status).toBe(403);
  });

  it("succeeds", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.createSeason).mockResolvedValue({ id: "s1" });
    const res = await createSeasonRoute(jsonReq({ name: "Fall" }), { params: { id: "l1" } });
    expect(res.status).toBe(200);
    expect((await res.json()).seasonId).toBe("s1");
  });
});

describe("GET /api/leagues/seasons/:seasonId", () => {
  it("404s when the season doesn't resolve to a league the caller belongs to", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.seasonLeagueId).mockResolvedValue(null);
    const res = await seasonDetailRoute(new Request("http://localhost/x"), { params: { seasonId: "s1" } });
    expect(res.status).toBe(404);
  });

  it("200s for a member", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.seasonLeagueId).mockResolvedValue("l1");
    vi.mocked(league.isLeagueMember).mockResolvedValue(true);
    vi.mocked(league.getSeasonDetail).mockResolvedValue({
      id: "s1",
      name: "Fall",
      leagueId: "l1",
      leagueName: "A",
      sessions: [],
    });
    const res = await seasonDetailRoute(new Request("http://localhost/x"), { params: { seasonId: "s1" } });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/leagues/seasons/:seasonId/sessions", () => {
  it("accepts an empty body (no label) and a JSON body with a label", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.startSession).mockResolvedValue({ id: "sess1" });

    const res1 = await startSessionRoute(emptyReq(), { params: { seasonId: "s1" } });
    expect(res1.status).toBe(200);
    expect(league.startSession).toHaveBeenCalledWith("s1", "user1", null);

    const res2 = await startSessionRoute(jsonReq({ label: "Opening night" }), { params: { seasonId: "s1" } });
    expect(res2.status).toBe(200);
    expect(league.startSession).toHaveBeenCalledWith("s1", "user1", "Opening night");
  });

  it("maps a null result (not commissioner) to 403", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.startSession).mockResolvedValue(null);
    const res = await startSessionRoute(emptyReq(), { params: { seasonId: "s1" } });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/leagues/seasons/:seasonId/standings", () => {
  it("404s a non-member, 200s a member with sorted standings", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.seasonLeagueId).mockResolvedValue("l1");
    vi.mocked(league.isLeagueMember).mockResolvedValueOnce(false);
    expect((await standingsRoute(new Request("http://localhost/x"), { params: { seasonId: "s1" } })).status).toBe(404);

    vi.mocked(league.isLeagueMember).mockResolvedValueOnce(true);
    vi.mocked(league.getSeasonStandings).mockResolvedValue([
      { userId: "u1", handle: "Alice", email: "a@b.com", totalPoints: 50, sessionsPlayed: 2 },
    ]);
    const res = await standingsRoute(new Request("http://localhost/x"), { params: { seasonId: "s1" } });
    expect(res.status).toBe(200);
    expect((await res.json()).standings).toHaveLength(1);
  });
});

describe("GET/POST /api/leagues/sessions/:sessionId/scores", () => {
  it("GET 404s a non-member", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.sessionLeagueId).mockResolvedValue("l1");
    vi.mocked(league.isLeagueMember).mockResolvedValue(false);
    const res = await scoresGetRoute(new Request("http://localhost/x"), { params: { sessionId: "sess1" } });
    expect(res.status).toBe(404);
  });

  it("POST validates entries shape before calling enterScores", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    const res = await scoresPostRoute(jsonReq({ entries: [{ userId: "u1", points: "not-a-number" }] }), {
      params: { sessionId: "sess1" },
    });
    expect(res.status).toBe(400);
    expect(league.enterScores).not.toHaveBeenCalled();
  });

  it("POST maps a false result (not commissioner) to 403, true to 200", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.enterScores).mockResolvedValueOnce(false);
    const res1 = await scoresPostRoute(jsonReq({ entries: [{ userId: "u1", points: 25 }] }), {
      params: { sessionId: "sess1" },
    });
    expect(res1.status).toBe(403);

    vi.mocked(league.enterScores).mockResolvedValueOnce(true);
    const res2 = await scoresPostRoute(jsonReq({ entries: [{ userId: "u1", points: 25 }] }), {
      params: { sessionId: "sess1" },
    });
    expect(res2.status).toBe(200);
    expect(league.enterScores).toHaveBeenCalledWith("sess1", "user1", [{ userId: "u1", points: 25 }]);
  });
});

describe("GET/POST /api/leagues/sessions/:sessionId/rooms", () => {
  it("GET 404s a non-member, 200s a member with linked rooms", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.sessionLeagueId).mockResolvedValue("l1");
    vi.mocked(league.isLeagueMember).mockResolvedValueOnce(false);
    expect((await roomsGetRoute(new Request("http://localhost/x"), { params: { sessionId: "sess1" } })).status).toBe(
      404,
    );

    vi.mocked(league.isLeagueMember).mockResolvedValueOnce(true);
    vi.mocked(league.getLinkedRooms).mockResolvedValue([{ roomId: "ROOM01", matchFinished: true }]);
    const res = await roomsGetRoute(new Request("http://localhost/x"), { params: { sessionId: "sess1" } });
    expect(res.status).toBe(200);
    expect((await res.json()).rooms).toHaveLength(1);
  });

  it("POST requires a roomId and maps a false result (not commissioner) to 403", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    expect((await roomsPostRoute(jsonReq({}), { params: { sessionId: "sess1" } })).status).toBe(400);

    vi.mocked(league.linkRoomToSession).mockResolvedValueOnce(false);
    expect((await roomsPostRoute(jsonReq({ roomId: "ROOM01" }), { params: { sessionId: "sess1" } })).status).toBe(403);

    vi.mocked(league.linkRoomToSession).mockResolvedValueOnce(true);
    const res = await roomsPostRoute(jsonReq({ roomId: "ROOM01" }), { params: { sessionId: "sess1" } });
    expect(res.status).toBe(200);
    expect(league.linkRoomToSession).toHaveBeenCalledWith("sess1", "user1", "ROOM01");
  });
});

describe("POST /api/leagues/sessions/:sessionId/sync", () => {
  it("requires auth and maps a null result (not commissioner) to 403", async () => {
    mockCurrentUser.mockResolvedValue(null);
    expect((await syncRoute(new Request("http://localhost/x"), { params: { sessionId: "sess1" } })).status).toBe(401);

    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.syncSessionScoresFromRooms).mockResolvedValueOnce(null);
    expect((await syncRoute(new Request("http://localhost/x"), { params: { sessionId: "sess1" } })).status).toBe(403);
  });

  it("returns the sync summary on success", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.syncSessionScoresFromRooms).mockResolvedValue({ syncedPlayers: 4, roomsSynced: 1, roomsSkipped: 0 });
    const res = await syncRoute(new Request("http://localhost/x"), { params: { sessionId: "sess1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ syncedPlayers: 4, roomsSynced: 1, roomsSkipped: 0 });
  });
});

describe("GET /api/leagues/:id/players/:userId", () => {
  it("404s when the caller isn't a member", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.isLeagueMember).mockResolvedValueOnce(false);
    const res = await playerHistoryRoute(new Request("http://localhost/x"), { params: { id: "l1", userId: "u2" } });
    expect(res.status).toBe(404);
  });

  it("404s when the target user isn't a member of this league either", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.isLeagueMember).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await playerHistoryRoute(new Request("http://localhost/x"), { params: { id: "l1", userId: "u2" } });
    expect(res.status).toBe(404);
  });

  it("200s with the player's history when both are members", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user1" });
    vi.mocked(league.isLeagueMember).mockResolvedValue(true);
    vi.mocked(league.getPlayerHistory).mockResolvedValue({
      userId: "u2",
      handle: "Bob",
      email: "bob@example.com",
      allTimeTotal: 30,
      seasons: [],
    });
    const res = await playerHistoryRoute(new Request("http://localhost/x"), { params: { id: "l1", userId: "u2" } });
    expect(res.status).toBe(200);
    expect((await res.json()).history.allTimeTotal).toBe(30);
  });
});
