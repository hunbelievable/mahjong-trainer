import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    match: { upsert: vi.fn(), update: vi.fn() },
    matchPlayer: { update: vi.fn(), upsert: vi.fn() },
    matchGame: { upsert: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  persistMatchCreate,
  persistMatchGame,
  persistSeatVacated,
  reconcileMatch,
  setRetryDelaysForTests,
  type MatchSnapshot,
} from "@/lib/server/matchStore";
import type { MatchGameSummary } from "@/lib/server/match";

const db = vi.mocked(prisma, true);

// Retry paths log every failed attempt by design; keep test output clean.
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

const GAME_RESULT = {
  matchId: "m1",
  gameNumber: 1,
  dealerSeat: "E",
  winnerSeat: "S",
  winKind: "discard",
  patternName: "Test Pattern",
  patternValue: 25,
  payouts: { E: -25, S: 100, W: -50, N: -25 },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  setRetryDelaysForTests([0, 0]); // 3 attempts, no real waiting
});

describe("matchStore — retry semantics", () => {
  it("retries a transient failure and succeeds", async () => {
    db.matchGame.upsert
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({} as never);

    await persistMatchGame({ ...GAME_RESULT });

    expect(db.matchGame.upsert).toHaveBeenCalledTimes(2);
    expect(db.matchGame.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { matchId_gameNumber: { matchId: "m1", gameNumber: 1 } },
      }),
    );
  });

  it("gives up after exhausting retries without throwing", async () => {
    db.matchGame.upsert.mockRejectedValue(new Error("db down"));

    await expect(persistMatchGame({ ...GAME_RESULT })).resolves.toBeUndefined();

    expect(db.matchGame.upsert).toHaveBeenCalledTimes(3); // 1 attempt + 2 retries
    expect(console.error).toHaveBeenCalled();
  });

  it("persistMatchCreate is an upsert, so a retry after an ambiguous success can't duplicate", async () => {
    db.match.upsert.mockResolvedValue({} as never);

    await persistMatchCreate("m1", "ROOM01", [
      { seat: "E", userId: "alice", isCpu: false, cpuDifficulty: null },
    ]);

    expect(db.match.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1" }, update: {} }),
    );
  });
});

describe("matchStore — persistSeatVacated", () => {
  it("marks the seat CPU-held from the given game, keeping userId for earlier attribution", async () => {
    db.matchPlayer.update.mockResolvedValue({} as never);

    await persistSeatVacated("m1", "S", "beginner", 3);

    expect(db.matchPlayer.update).toHaveBeenCalledWith({
      where: { matchId_seat: { matchId: "m1", seat: "S" } },
      data: { isCpu: true, cpuDifficulty: "beginner", vacatedAtGame: 3 },
    });
  });
});

describe("matchStore — reconcileMatch", () => {
  const history: MatchGameSummary[] = [
    { ...GAME_RESULT, gameNumber: 1 },
    { ...GAME_RESULT, gameNumber: 2, winnerSeat: null, winKind: "wall", patternName: null, patternValue: null, payouts: { E: 0, S: 0, W: 0, N: 0 } },
  ];
  const snapshot: MatchSnapshot = {
    matchId: "m1",
    roomId: "ROOM01",
    players: [
      { seat: "E", userId: "creator", isCpu: false, cpuDifficulty: null, score: -25, vacatedAtGame: null },
      { seat: "S", userId: "alice", isCpu: true, cpuDifficulty: "beginner", score: 100, vacatedAtGame: 2 },
      { seat: "W", userId: null, isCpu: true, cpuDifficulty: "intermediate", score: -50, vacatedAtGame: null },
      { seat: "N", userId: null, isCpu: true, cpuDifficulty: "intermediate", score: -25, vacatedAtGame: null },
    ],
    history,
    endedAt: new Date(1234567890),
  };

  beforeEach(() => {
    db.match.upsert.mockResolvedValue({} as never);
    db.match.update.mockResolvedValue({} as never);
    db.matchPlayer.upsert.mockResolvedValue({} as never);
    db.matchGame.upsert.mockResolvedValue({} as never);
  });

  it("upserts the match, every player, every game, and stamps endedAt", async () => {
    await reconcileMatch(snapshot);

    expect(db.match.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1" } }),
    );
    expect(db.matchPlayer.upsert).toHaveBeenCalledTimes(4);
    expect(db.matchPlayer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId_seat: { matchId: "m1", seat: "S" } },
        // The vacated seat: still attributed to alice, but CPU-held from game 2.
        update: { userId: "alice", isCpu: true, cpuDifficulty: "beginner", vacatedAtGame: 2, score: 100 },
      }),
    );
    expect(db.matchGame.upsert).toHaveBeenCalledTimes(2);
    expect(db.matchGame.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId_gameNumber: { matchId: "m1", gameNumber: 2 } },
      }),
    );
    expect(db.match.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { endedAt: snapshot.endedAt },
    });
  });

  it("retries the whole reconcile on failure and still resolves", async () => {
    db.matchPlayer.upsert.mockRejectedValueOnce(new Error("blip"));

    await expect(reconcileMatch(snapshot)).resolves.toBeUndefined();

    // First pass died at a player upsert; second pass completed all four plus games.
    expect(db.match.upsert).toHaveBeenCalledTimes(2);
    expect(db.matchPlayer.upsert).toHaveBeenCalledTimes(5);
    expect(db.matchGame.upsert).toHaveBeenCalledTimes(2);
  });
});
