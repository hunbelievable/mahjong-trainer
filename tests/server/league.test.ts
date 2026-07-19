import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    league: { create: vi.fn(), findUnique: vi.fn() },
    leagueMember: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    season: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    leagueSession: { create: vi.fn(), findUnique: vi.fn() },
    scoreRecord: { findMany: vi.fn(), upsert: vi.fn() },
    user: { upsert: vi.fn(), findUnique: vi.fn() },
    room: { upsert: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  createLeague,
  listMyLeagues,
  getLeagueDetail,
  isLeagueMember,
  addMember,
  createSeason,
  seasonLeagueId,
  sessionLeagueId,
  startSession,
  enterScores,
  getSessionScores,
  getSeasonStandings,
  getSeasonDetail,
  linkRoomToSession,
  getLinkedRooms,
  syncSessionScoresFromRooms,
  getPlayerHistory,
} from "@/lib/server/league";

const db = vi.mocked(prisma, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("league — createLeague", () => {
  it("creates the League and seats the creator as commissioner in one write", async () => {
    db.league.create.mockResolvedValue({ id: "league1" } as never);

    const result = await createLeague("user1", "Tuesday Night Mahj");

    expect(result).toEqual({ id: "league1" });
    expect(db.league.create).toHaveBeenCalledWith({
      data: {
        name: "Tuesday Night Mahj",
        commissionerUserId: "user1",
        members: { create: { userId: "user1", role: "commissioner" } },
      },
    });
  });
});

describe("league — listMyLeagues", () => {
  it("maps memberships to summaries with role and member count", async () => {
    db.leagueMember.findMany.mockResolvedValue([
      {
        role: "commissioner",
        league: { id: "league1", name: "A League", _count: { members: 3 } },
      },
      {
        role: "member",
        league: { id: "league2", name: "B League", _count: { members: 5 } },
      },
    ] as never);

    const leagues = await listMyLeagues("user1");

    expect(leagues).toEqual([
      { id: "league1", name: "A League", role: "commissioner", memberCount: 3 },
      { id: "league2", name: "B League", role: "member", memberCount: 5 },
    ]);
  });
});

describe("league — getLeagueDetail", () => {
  it("returns null for an unknown league", async () => {
    db.league.findUnique.mockResolvedValue(null);
    expect(await getLeagueDetail("nope")).toBeNull();
  });

  it("maps members (with handle/email) and seasons", async () => {
    db.league.findUnique.mockResolvedValue({
      id: "league1",
      name: "A League",
      commissionerUserId: "user1",
      members: [
        { userId: "user1", role: "commissioner", user: { email: "a@b.com", handle: "Alice" } },
        { userId: "user2", role: "member", user: { email: "c@d.com", handle: null } },
      ],
      seasons: [{ id: "season1", name: "Fall", startsAt: new Date(1), endsAt: null }],
    } as never);

    const detail = await getLeagueDetail("league1");

    expect(detail).toMatchObject({
      id: "league1",
      name: "A League",
      commissionerUserId: "user1",
      members: [
        { userId: "user1", email: "a@b.com", handle: "Alice", role: "commissioner" },
        { userId: "user2", email: "c@d.com", handle: null, role: "member" },
      ],
      seasons: [{ id: "season1", name: "Fall", endsAt: null }],
    });
  });
});

describe("league — isLeagueMember", () => {
  it("is true when a membership row exists, false otherwise", async () => {
    db.leagueMember.findUnique.mockResolvedValueOnce({ id: "m1" } as never);
    expect(await isLeagueMember("league1", "user1")).toBe(true);

    db.leagueMember.findUnique.mockResolvedValueOnce(null);
    expect(await isLeagueMember("league1", "user2")).toBe(false);
  });
});

describe("league — addMember", () => {
  it("rejects a non-commissioner", async () => {
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    const ok = await addMember("league1", "not-the-commissioner", "new@example.com");
    expect(ok).toBe(false);
    expect(db.leagueMember.create).not.toHaveBeenCalled();
  });

  it("upserts the User by email and creates the membership", async () => {
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    db.user.upsert.mockResolvedValue({ id: "user2", email: "new@example.com" } as never);
    db.leagueMember.create.mockResolvedValue({} as never);

    const ok = await addMember("league1", "user1", "new@example.com");

    expect(ok).toBe(true);
    expect(db.user.upsert).toHaveBeenCalledWith({
      where: { email: "new@example.com" },
      update: {},
      create: { email: "new@example.com" },
    });
    expect(db.leagueMember.create).toHaveBeenCalledWith({
      data: { leagueId: "league1", userId: "user2", role: "member" },
    });
  });

  it("returns false (not throw) when the user is already a member", async () => {
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    db.user.upsert.mockResolvedValue({ id: "user2", email: "new@example.com" } as never);
    db.leagueMember.create.mockRejectedValue(new Error("unique constraint"));

    expect(await addMember("league1", "user1", "new@example.com")).toBe(false);
  });
});

describe("league — createSeason", () => {
  it("rejects a non-commissioner", async () => {
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    expect(await createSeason("league1", "someone-else", "Fall")).toBeNull();
    expect(db.season.create).not.toHaveBeenCalled();
  });

  it("creates the season for the commissioner", async () => {
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    db.season.create.mockResolvedValue({ id: "season1" } as never);

    expect(await createSeason("league1", "user1", "Fall")).toEqual({ id: "season1" });
    expect(db.season.create).toHaveBeenCalledWith({ data: { leagueId: "league1", name: "Fall" } });
  });
});

describe("league — seasonLeagueId / sessionLeagueId", () => {
  it("resolves a season's leagueId, or null if unknown", async () => {
    db.season.findUnique.mockResolvedValueOnce({ leagueId: "league1" } as never);
    expect(await seasonLeagueId("season1")).toBe("league1");

    db.season.findUnique.mockResolvedValueOnce(null);
    expect(await seasonLeagueId("nope")).toBeNull();
  });

  it("resolves a session's leagueId via its season, or null if unknown", async () => {
    db.leagueSession.findUnique.mockResolvedValueOnce({ season: { leagueId: "league1" } } as never);
    expect(await sessionLeagueId("session1")).toBe("league1");

    db.leagueSession.findUnique.mockResolvedValueOnce(null);
    expect(await sessionLeagueId("nope")).toBeNull();
  });
});

describe("league — startSession", () => {
  it("rejects a non-commissioner", async () => {
    db.season.findUnique.mockResolvedValue({ leagueId: "league1" } as never);
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    expect(await startSession("season1", "someone-else", null)).toBeNull();
    expect(db.leagueSession.create).not.toHaveBeenCalled();
  });

  it("creates the session with an optional label", async () => {
    db.season.findUnique.mockResolvedValue({ leagueId: "league1" } as never);
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    db.leagueSession.create.mockResolvedValue({ id: "session1" } as never);

    expect(await startSession("season1", "user1", "Opening night")).toEqual({ id: "session1" });
    expect(db.leagueSession.create).toHaveBeenCalledWith({
      data: { seasonId: "season1", label: "Opening night" },
    });
  });
});

describe("league — enterScores", () => {
  it("rejects a non-commissioner", async () => {
    db.leagueSession.findUnique.mockResolvedValue({ season: { leagueId: "league1" } } as never);
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);

    const ok = await enterScores("session1", "someone-else", [{ userId: "user2", points: 25 }]);
    expect(ok).toBe(false);
    expect(db.scoreRecord.upsert).not.toHaveBeenCalled();
  });

  it("upserts one ScoreRecord per entry, keyed by (sessionId, userId) so re-entry updates in place", async () => {
    db.leagueSession.findUnique.mockResolvedValue({ season: { leagueId: "league1" } } as never);
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    db.scoreRecord.upsert.mockResolvedValue({} as never);

    const ok = await enterScores("session1", "user1", [
      { userId: "user1", points: 50 },
      { userId: "user2", points: -25 },
    ]);

    expect(ok).toBe(true);
    expect(db.scoreRecord.upsert).toHaveBeenCalledTimes(2);
    expect(db.scoreRecord.upsert).toHaveBeenCalledWith({
      where: { sessionId_userId: { sessionId: "session1", userId: "user1" } },
      create: { sessionId: "session1", userId: "user1", points: 50, source: "manual", enteredByUserId: "user1" },
      update: { points: 50, enteredByUserId: "user1" },
    });
  });
});

describe("league — getSessionScores", () => {
  it("maps ScoreRecords with the user's handle/email", async () => {
    db.scoreRecord.findMany.mockResolvedValue([
      { userId: "user1", points: 50, user: { email: "a@b.com", handle: "Alice" } },
    ] as never);

    expect(await getSessionScores("session1")).toEqual([
      { userId: "user1", handle: "Alice", email: "a@b.com", points: 50 },
    ]);
  });
});

describe("league — getSeasonStandings", () => {
  it("sums points per user across sessions and sorts highest first", async () => {
    db.scoreRecord.findMany.mockResolvedValue([
      { userId: "user1", points: 50, user: { email: "a@b.com", handle: "Alice" } },
      { userId: "user2", points: 100, user: { email: "c@d.com", handle: null } },
      { userId: "user1", points: -20, user: { email: "a@b.com", handle: "Alice" } },
    ] as never);

    const standings = await getSeasonStandings("season1");

    expect(standings).toEqual([
      { userId: "user2", handle: null, email: "c@d.com", totalPoints: 100, sessionsPlayed: 1 },
      { userId: "user1", handle: "Alice", email: "a@b.com", totalPoints: 30, sessionsPlayed: 2 },
    ]);
    expect(db.scoreRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { session: { seasonId: "season1" } } }),
    );
  });

  it("returns an empty list when no scores have been entered", async () => {
    db.scoreRecord.findMany.mockResolvedValue([]);
    expect(await getSeasonStandings("season1")).toEqual([]);
  });
});

describe("league — linkRoomToSession", () => {
  it("rejects a non-commissioner", async () => {
    db.leagueSession.findUnique.mockResolvedValue({ season: { leagueId: "league1" } } as never);
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    expect(await linkRoomToSession("session1", "someone-else", "ROOM01")).toBe(false);
    expect(db.room.upsert).not.toHaveBeenCalled();
  });

  it("upserts the Room row with leagueSessionId set — even if the room's Postgres row doesn't exist yet", async () => {
    db.leagueSession.findUnique.mockResolvedValue({ season: { leagueId: "league1" } } as never);
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    db.room.upsert.mockResolvedValue({} as never);

    expect(await linkRoomToSession("session1", "user1", "ROOM01")).toBe(true);
    expect(db.room.upsert).toHaveBeenCalledWith({
      where: { id: "ROOM01" },
      create: { id: "ROOM01", leagueSessionId: "session1", createdById: "user1" },
      update: { leagueSessionId: "session1" },
    });
  });
});

describe("league — getLinkedRooms", () => {
  it("maps rooms to whether their latest match has finished", async () => {
    db.room.findMany.mockResolvedValue([
      { id: "ROOM01", matches: [{ endedAt: new Date(1) }] },
      { id: "ROOM02", matches: [{ endedAt: null }] },
      { id: "ROOM03", matches: [] }, // linked but never even started a match
    ] as never);

    expect(await getLinkedRooms("session1")).toEqual([
      { roomId: "ROOM01", matchFinished: true },
      { roomId: "ROOM02", matchFinished: false },
      { roomId: "ROOM03", matchFinished: false },
    ]);
  });
});

describe("league — syncSessionScoresFromRooms", () => {
  it("rejects a non-commissioner", async () => {
    db.leagueSession.findUnique.mockResolvedValue({ season: { leagueId: "league1" } } as never);
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    expect(await syncSessionScoresFromRooms("session1", "someone-else")).toBeNull();
    expect(db.room.findMany).not.toHaveBeenCalled();
  });

  it("sums payouts per player across a room's whole match (excluding games at/after vacatedAtGame) and skips unfinished rooms", async () => {
    db.leagueSession.findUnique.mockResolvedValue({ season: { leagueId: "league1" } } as never);
    db.league.findUnique.mockResolvedValue({ commissionerUserId: "user1" } as never);
    db.room.findMany.mockResolvedValue([
      {
        id: "ROOM01",
        matches: [
          {
            id: "match1",
            endedAt: new Date(1),
            players: [
              { seat: "E", userId: "alice", vacatedAtGame: null },
              { seat: "S", userId: "bob", vacatedAtGame: 2 }, // kicked before game 2
              { seat: "W", userId: null, vacatedAtGame: null }, // CPU seat — never a human
            ],
            games: [
              { gameNumber: 1, payouts: { E: 50, S: -25, W: -25, N: 0 } },
              { gameNumber: 2, payouts: { E: -10, S: 30, W: -10, N: -10 } }, // excluded for bob
            ],
          },
        ],
      },
      { id: "ROOM02", matches: [{ id: "match2", endedAt: null, players: [], games: [] }] }, // still in progress
    ] as never);
    db.scoreRecord.upsert.mockResolvedValue({} as never);

    const result = await syncSessionScoresFromRooms("session1", "user1");

    expect(result).toEqual({ syncedPlayers: 2, roomsSynced: 1, roomsSkipped: 1 });
    expect(db.scoreRecord.upsert).toHaveBeenCalledWith({
      where: { sessionId_userId: { sessionId: "session1", userId: "alice" } },
      create: {
        sessionId: "session1",
        userId: "alice",
        points: 40, // 50 + -10, not vacated
        source: "online",
        matchId: "match1",
        enteredByUserId: "user1",
      },
      update: { points: 40, source: "online", matchId: "match1", enteredByUserId: "user1" },
    });
    expect(db.scoreRecord.upsert).toHaveBeenCalledWith({
      where: { sessionId_userId: { sessionId: "session1", userId: "bob" } },
      create: {
        sessionId: "session1",
        userId: "bob",
        points: -25, // only game 1 — vacated before game 2
        source: "online",
        matchId: "match1",
        enteredByUserId: "user1",
      },
      update: { points: -25, source: "online", matchId: "match1", enteredByUserId: "user1" },
    });
  });
});

describe("league — getPlayerHistory", () => {
  it("returns null for an unknown user", async () => {
    db.user.findUnique.mockResolvedValue(null);
    expect(await getPlayerHistory("league1", "nope")).toBeNull();
  });

  it("sums per-season totals and omits seasons with no scores for this player", async () => {
    db.user.findUnique.mockResolvedValue({ id: "user1", email: "a@b.com", handle: "Alice" } as never);
    db.season.findMany.mockResolvedValue([
      {
        id: "season1",
        name: "Fall",
        sessions: [{ scores: [{ points: 50 }] }, { scores: [{ points: -10 }] }],
      },
      {
        id: "season2",
        name: "Spring",
        sessions: [{ scores: [] }], // this player never scored this season
      },
    ] as never);

    const history = await getPlayerHistory("league1", "user1");

    expect(history).toEqual({
      userId: "user1",
      handle: "Alice",
      email: "a@b.com",
      allTimeTotal: 40,
      seasons: [{ seasonId: "season1", seasonName: "Fall", totalPoints: 40, sessionsPlayed: 2 }],
    });
  });
});

describe("league — getSeasonDetail", () => {
  it("returns null for an unknown season", async () => {
    db.season.findUnique.mockResolvedValue(null);
    expect(await getSeasonDetail("nope")).toBeNull();
  });

  it("maps the season with its league name and sessions", async () => {
    db.season.findUnique.mockResolvedValue({
      id: "season1",
      name: "Fall",
      leagueId: "league1",
      league: { name: "A League" },
      sessions: [{ id: "session1", scheduledAt: new Date(1), label: "Week 1" }],
    } as never);

    expect(await getSeasonDetail("season1")).toEqual({
      id: "season1",
      name: "Fall",
      leagueId: "league1",
      leagueName: "A League",
      sessions: [{ id: "session1", scheduledAt: new Date(1), label: "Week 1" }],
    });
  });
});
