import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export interface PlayerStats {
  player: string;
  totalMoves: number;
  avgProbBefore: number;
  avgProbAfter: number;
  avgDelta: number;          // average prob change per discard (positive = good)
  bestDelta: number;
  worstDelta: number;
  improvingMoves: number;    // discards that raised win prob
  harmfulMoves: number;      // discards that lowered win prob
}

export interface GameStats {
  totalGames: number;
  finishedGames: number;
  winsByPlayer: Record<string, number>;
  playerStats: PlayerStats[];
}

// GET /api/stats — aggregate statistics across all recorded games
export async function GET() {
  try {
    const [games, moves] = await Promise.all([
      prisma.game.findMany({ select: { id: true, winner: true, finishedAt: true } }),
      prisma.moveRecord.findMany({
        where: { action: "discard" },
        select: { player: true, winProbBefore: true, winProbAfter: true },
      }),
    ]);

    const totalGames = games.length;
    const finishedGames = games.filter(g => g.finishedAt !== null).length;

    // Win counts
    const winsByPlayer: Record<string, number> = {};
    for (const g of games) {
      if (g.winner) {
        winsByPlayer[g.winner] = (winsByPlayer[g.winner] ?? 0) + 1;
      }
    }

    // Per-player move stats
    const byPlayer: Record<string, { before: number[]; after: number[]; deltas: number[] }> = {};
    for (const m of moves) {
      if (!byPlayer[m.player]) byPlayer[m.player] = { before: [], after: [], deltas: [] };
      const delta = m.winProbAfter - m.winProbBefore;
      byPlayer[m.player].before.push(m.winProbBefore);
      byPlayer[m.player].after.push(m.winProbAfter);
      byPlayer[m.player].deltas.push(delta);
    }

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const playerStats: PlayerStats[] = Object.entries(byPlayer).map(([player, data]) => ({
      player,
      totalMoves: data.deltas.length,
      avgProbBefore: avg(data.before),
      avgProbAfter: avg(data.after),
      avgDelta: avg(data.deltas),
      bestDelta: data.deltas.length ? Math.max(...data.deltas) : 0,
      worstDelta: data.deltas.length ? Math.min(...data.deltas) : 0,
      improvingMoves: data.deltas.filter(d => d > 0.01).length,
      harmfulMoves: data.deltas.filter(d => d < -0.01).length,
    }));

    // Sort by total moves descending
    playerStats.sort((a, b) => b.totalMoves - a.totalMoves);

    return NextResponse.json({ totalGames, finishedGames, winsByPlayer, playerStats } satisfies GameStats);
  } catch {
    return NextResponse.json({ error: "Failed to compute stats" }, { status: 500 });
  }
}
