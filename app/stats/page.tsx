"use client";

import { useEffect, useState } from "react";
import type { GameStats, PlayerStats } from "@/app/api/stats/route";

const SEAT_LABELS: Record<string, string> = { E: "East", S: "South", W: "West", N: "North" };

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }
function delta(n: number) {
  const s = `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
  return <span className={n > 0 ? "text-emerald-600" : n < 0 ? "text-red-500" : "text-gray-400"}>{s}</span>;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function PlayerRow({ s }: { s: PlayerStats }) {
  const winRate = s.improvingMoves + s.harmfulMoves > 0
    ? s.improvingMoves / (s.improvingMoves + s.harmfulMoves + (s.totalMoves - s.improvingMoves - s.harmfulMoves))
    : 0;

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-4 py-2 text-sm font-semibold text-gray-700">
        {SEAT_LABELS[s.player] ?? s.player}
      </td>
      <td className="px-4 py-2 text-sm text-center font-mono text-gray-600">{s.totalMoves}</td>
      <td className="px-4 py-2 text-sm text-center font-mono">{pct(s.avgProbBefore)}</td>
      <td className="px-4 py-2 text-sm text-center font-mono">{delta(s.avgDelta)}</td>
      <td className="px-4 py-2 text-sm text-center font-mono">{delta(s.bestDelta)}</td>
      <td className="px-4 py-2 text-sm text-center font-mono">{delta(s.worstDelta)}</td>
      <td className="px-4 py-2 text-sm text-center">
        <span className="text-emerald-600 font-mono">{s.improvingMoves}</span>
        <span className="text-gray-300 mx-1">/</span>
        <span className="text-red-500 font-mono">{s.harmfulMoves}</span>
      </td>
      <td className="px-4 py-2 text-sm text-center">
        <div className="w-full bg-gray-100 rounded-full h-2 relative overflow-hidden">
          <div
            className="bg-emerald-400 h-2 rounded-full"
            style={{ width: `${(winRate * 100).toFixed(0)}%` }}
          />
        </div>
      </td>
    </tr>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then(r => r.json())
      .then(setStats)
      .catch(() => setError("Failed to load stats"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">
      Loading…
    </div>
  );

  if (error || !stats) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-red-500">
      {error ?? "No data"}
    </div>
  );

  const totalWins = Object.values(stats.winsByPlayer).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Statistics</h1>
          <p className="text-sm text-gray-500 mt-0.5">All players · All games</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Games recorded" value={stats.totalGames} />
          <StatCard label="Completed" value={stats.finishedGames} />
          <StatCard label="Total wins" value={totalWins} />
          <StatCard
            label="Most wins"
            value={
              Object.entries(stats.winsByPlayer).sort((a, b) => b[1] - a[1])[0]
                ? `${SEAT_LABELS[Object.entries(stats.winsByPlayer).sort((a, b) => b[1] - a[1])[0][0]] ?? "—"}`
                : "—"
            }
            sub={
              Object.entries(stats.winsByPlayer).sort((a, b) => b[1] - a[1])[0]
                ? `${Object.entries(stats.winsByPlayer).sort((a, b) => b[1] - a[1])[0][1]} wins`
                : undefined
            }
          />
        </div>

        {/* Win distribution */}
        {totalWins > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Win distribution</div>
            <div className="flex gap-3 flex-wrap">
              {Object.entries(stats.winsByPlayer)
                .sort((a, b) => b[1] - a[1])
                .map(([seat, wins]) => (
                  <div key={seat} className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-gray-700">{SEAT_LABELS[seat] ?? seat}</span>
                    <span className="text-sm font-mono text-gray-500">{wins}</span>
                    <div className="w-20 bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-indigo-400 h-1.5 rounded-full"
                        style={{ width: `${((wins / totalWins) * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400">{((wins / totalWins) * 100).toFixed(0)}%</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Per-player discard quality */}
        {stats.playerStats.length > 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Discard quality by player</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 font-semibold uppercase tracking-wide">
                    <th className="px-4 py-2 text-left">Player</th>
                    <th className="px-4 py-2 text-center">Discards</th>
                    <th className="px-4 py-2 text-center">Avg prob before</th>
                    <th className="px-4 py-2 text-center">Avg Δ/discard</th>
                    <th className="px-4 py-2 text-center">Best Δ</th>
                    <th className="px-4 py-2 text-center">Worst Δ</th>
                    <th className="px-4 py-2 text-center">↑ / ↓</th>
                    <th className="px-4 py-2 text-center w-24">Improving rate</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.playerStats.map(s => <PlayerRow key={s.player} s={s} />)}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-sm text-gray-400 italic">
            No move data yet. Play a simulation or observe a game to start collecting stats.
          </div>
        )}
      </div>
    </div>
  );
}
