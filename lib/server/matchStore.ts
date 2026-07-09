// =============================================================================
// Durable READ-MODEL persistence for Match/MatchPlayer/MatchGame (Prisma/
// Postgres) — mirrors eventLog.ts's fire-and-forget philosophy: RoomManager's
// in-memory match state is authoritative for live play, these writes are a
// side-effect that must never block or throw into the caller. See
// docs/multiplayer-design.md §18 and prisma/schema.prisma's domain-projection
// comment.
// =============================================================================

import { prisma } from "@/lib/prisma";
import type { PlayerId } from "@/engine/tiles";
import type { DifficultyLevel } from "@/engine/cpu";
import type { WinKind } from "./match";

export interface MatchPlayerSeed {
  seat: PlayerId;
  userId: string | null;
  isCpu: boolean;
  cpuDifficulty: DifficultyLevel | null;
}

/** Creates the Match (and its Room row, if not already persisted) + one MatchPlayer per physical seat. */
export async function persistMatchCreate(
  matchId: string,
  roomId: string,
  players: MatchPlayerSeed[],
): Promise<void> {
  try {
    await prisma.match.create({
      data: {
        id: matchId,
        room: { connectOrCreate: { where: { id: roomId }, create: { id: roomId } } },
        players: {
          create: players.map((p) => ({
            seat: p.seat,
            userId: p.userId,
            isCpu: p.isCpu,
            cpuDifficulty: p.cpuDifficulty,
          })),
        },
      },
    });
  } catch (err) {
    console.error(`[matchStore] failed to persist Match ${matchId}:`, err);
  }
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

export async function persistMatchGame(result: MatchGameResult): Promise<void> {
  try {
    await prisma.matchGame.create({
      data: {
        matchId: result.matchId,
        gameNumber: result.gameNumber,
        dealerSeat: result.dealerSeat,
        winnerSeat: result.winnerSeat,
        winKind: result.winKind,
        patternName: result.patternName,
        patternValue: result.patternValue,
        payouts: result.payouts,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`[matchStore] failed to persist MatchGame ${result.matchId}#${result.gameNumber}:`, err);
  }
}

export async function persistMatchPlayerScores(
  matchId: string,
  scores: Record<PlayerId, number>,
): Promise<void> {
  try {
    await Promise.all(
      (Object.keys(scores) as PlayerId[]).map((seat) =>
        prisma.matchPlayer.update({
          where: { matchId_seat: { matchId, seat } },
          data: { score: scores[seat] },
        }),
      ),
    );
  } catch (err) {
    console.error(`[matchStore] failed to persist scores for Match ${matchId}:`, err);
  }
}

/** Marks a match as concluded (room closed by its creator). */
export async function persistMatchEnd(matchId: string): Promise<void> {
  try {
    await prisma.match.update({ where: { id: matchId }, data: { endedAt: new Date() } });
  } catch (err) {
    console.error(`[matchStore] failed to persist end of Match ${matchId}:`, err);
  }
}
