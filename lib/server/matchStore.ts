// =============================================================================
// Durable READ-MODEL persistence for Match/MatchPlayer/MatchGame (Prisma/
// Postgres). RoomManager's in-memory match state stays authoritative for live
// play, and these writes still never block or throw into the caller — but
// unlike the app's other fire-and-forget sinks, this data feeds standings, so
// it gets at-least-once semantics: every write retries with backoff, every
// write is idempotent (upserts on unique keys), and closing a room reconciles
// the full in-memory match against Postgres to backfill anything a transient
// outage dropped. A process crash before close can still lose results — that
// gap is the deferred resume-from-NATS-log work, not this module's job. See
// docs/multiplayer-design.md §18 and prisma/schema.prisma's domain-projection
// comment.
// =============================================================================

import { prisma } from "@/lib/prisma";
import type { PlayerId } from "@/engine/tiles";
import type { DifficultyLevel } from "@/engine/cpu";
import type { WinKind, MatchGameSummary } from "./match";

const DEFAULT_RETRY_DELAYS_MS = [500, 2000, 8000];
// Under vitest, default to a single attempt (the pre-retry behavior) so suites
// that exercise RoomManager without a database don't spend ~10s per failed
// write retrying into the void. matchStore's own tests opt back in per-case.
let retryDelaysMs: readonly number[] = process.env.VITEST ? [] : DEFAULT_RETRY_DELAYS_MS;

/** Tests shrink the backoff to keep the suite fast; production never calls this. */
export function setRetryDelaysForTests(delays: readonly number[]): void {
  retryDelaysMs = delays;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Don't let a pending retry hold the process open on shutdown.
    timer.unref?.();
  });
}

/**
 * Run a write with bounded retries. Resolves (never rejects) either way —
 * callers stay fire-and-forget. Writes passed here must be idempotent, since
 * a retry can follow an ambiguous failure whose first attempt actually landed.
 */
async function withRetry(label: string, write: () => Promise<unknown>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await write();
      return;
    } catch (err) {
      if (attempt >= retryDelaysMs.length) {
        console.error(`[matchStore] ${label} failed after ${attempt + 1} attempts:`, err);
        return;
      }
      console.warn(`[matchStore] ${label} failed (attempt ${attempt + 1}), retrying:`, err);
      await sleep(retryDelaysMs[attempt]);
    }
  }
}

export interface MatchPlayerSeed {
  seat: PlayerId;
  userId: string | null;
  isCpu: boolean;
  cpuDifficulty: DifficultyLevel | null;
}

function playerCreateData(p: MatchPlayerSeed) {
  return { seat: p.seat, userId: p.userId, isCpu: p.isCpu, cpuDifficulty: p.cpuDifficulty };
}

/** Creates the Match (and its Room row, if not already persisted) + one MatchPlayer per physical seat. */
export function persistMatchCreate(
  matchId: string,
  roomId: string,
  players: MatchPlayerSeed[],
): Promise<void> {
  return withRetry(`persist Match ${matchId}`, () =>
    prisma.match.upsert({
      where: { id: matchId },
      create: {
        id: matchId,
        room: { connectOrCreate: { where: { id: roomId }, create: { id: roomId } } },
        players: { create: players.map(playerCreateData) },
      },
      update: {},
    }),
  );
}

export interface MatchGameResult {
  matchId: string;
  gameNumber: number;
  dealerSeat: PlayerId;
  winnerSeat: PlayerId | null;
  winKind: WinKind;
  patternName: string | null;
  patternValue: number | null;
  payouts: Record<PlayerId, number>;
}

function gameResultData(result: Omit<MatchGameResult, "matchId">) {
  return {
    dealerSeat: result.dealerSeat,
    winnerSeat: result.winnerSeat,
    winKind: result.winKind,
    patternName: result.patternName,
    patternValue: result.patternValue,
    payouts: result.payouts,
  };
}

export function persistMatchGame(result: MatchGameResult): Promise<void> {
  return withRetry(`persist MatchGame ${result.matchId}#${result.gameNumber}`, () =>
    prisma.matchGame.upsert({
      where: { matchId_gameNumber: { matchId: result.matchId, gameNumber: result.gameNumber } },
      create: {
        matchId: result.matchId,
        gameNumber: result.gameNumber,
        ...gameResultData(result),
        finishedAt: new Date(),
      },
      update: gameResultData(result),
    }),
  );
}

export function persistMatchPlayerScores(
  matchId: string,
  scores: Record<PlayerId, number>,
): Promise<void> {
  return withRetry(`persist scores for Match ${matchId}`, () =>
    Promise.all(
      (Object.keys(scores) as PlayerId[]).map((seat) =>
        prisma.matchPlayer.update({
          where: { matchId_seat: { matchId, seat } },
          data: { score: scores[seat] },
        }),
      ),
    ),
  );
}

/**
 * Records a mid-match kick/forfeit on the seat's MatchPlayer row. `userId`
 * deliberately stays set — hands played before `vacatedAtGame` remain
 * attributable to the human who played them; hands from that game on were
 * CPU-played (how standings/league aggregation treats those is a policy
 * decision that lives with the reader, not this record).
 */
export function persistSeatVacated(
  matchId: string,
  seat: PlayerId,
  cpuDifficulty: DifficultyLevel,
  vacatedAtGame: number,
): Promise<void> {
  return withRetry(`persist vacated seat ${seat} for Match ${matchId}`, () =>
    prisma.matchPlayer.update({
      where: { matchId_seat: { matchId, seat } },
      data: { isCpu: true, cpuDifficulty, vacatedAtGame },
    }),
  );
}

/** The full in-memory truth of a match, for reconciliation at close time. */
export interface MatchSnapshot {
  matchId: string;
  roomId: string;
  players: Array<MatchPlayerSeed & { score: number; vacatedAtGame: number | null }>;
  history: MatchGameSummary[];
  endedAt: Date;
}

/**
 * Room closed: compare the authoritative in-memory match against Postgres and
 * backfill anything the per-write path dropped during an outage — the Match
 * row itself, any missing MatchPlayer/MatchGame rows, final scores and vacated
 * seats — then stamp `endedAt`. Fully idempotent, so it runs unconditionally
 * on every close rather than trying to detect whether anything was missed.
 */
export function reconcileMatch(snapshot: MatchSnapshot): Promise<void> {
  return withRetry(`reconcile Match ${snapshot.matchId}`, async () => {
    await prisma.match.upsert({
      where: { id: snapshot.matchId },
      create: {
        id: snapshot.matchId,
        room: { connectOrCreate: { where: { id: snapshot.roomId }, create: { id: snapshot.roomId } } },
      },
      update: {},
    });
    for (const p of snapshot.players) {
      const state = {
        userId: p.userId,
        isCpu: p.isCpu,
        cpuDifficulty: p.cpuDifficulty,
        vacatedAtGame: p.vacatedAtGame,
        score: p.score,
      };
      await prisma.matchPlayer.upsert({
        where: { matchId_seat: { matchId: snapshot.matchId, seat: p.seat } },
        create: { matchId: snapshot.matchId, seat: p.seat, ...state },
        update: state,
      });
    }
    for (const game of snapshot.history) {
      await prisma.matchGame.upsert({
        where: { matchId_gameNumber: { matchId: snapshot.matchId, gameNumber: game.gameNumber } },
        create: {
          matchId: snapshot.matchId,
          gameNumber: game.gameNumber,
          ...gameResultData(game),
          finishedAt: new Date(),
        },
        update: gameResultData(game),
      });
    }
    await prisma.match.update({
      where: { id: snapshot.matchId },
      data: { endedAt: snapshot.endedAt },
    });
  });
}
