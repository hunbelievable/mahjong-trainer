"use client";

import { useStudy, SEAT_LABELS, type SavedGame, type SavedMove, type PlayerSnapshot } from "@/lib/useStudy";
import WinProbChart from "@/components/WinProbChart";
import { tileLabel } from "@/lib/shorthand";
import type { Suit } from "@/engine/tiles";

const SUIT_PILL: Record<Suit, string> = {
  dots:   "bg-blue-100 text-blue-800",
  bams:   "bg-green-100 text-green-800",
  cracks: "bg-red-100 text-red-800",
  wind:   "bg-yellow-100 text-yellow-800",
  dragon: "bg-purple-100 text-purple-800",
  flower: "bg-pink-100 text-pink-800",
  joker:  "bg-gray-100 text-gray-800",
};

const SEAT_BORDER: Record<string, string> = {
  E: "border-indigo-300 bg-indigo-50",
  S: "border-emerald-300 bg-emerald-50",
  W: "border-amber-300 bg-amber-50",
  N: "border-red-300 bg-red-50",
};
const SEAT_LABEL_COLOR: Record<string, string> = {
  E: "text-indigo-700", S: "text-emerald-700", W: "text-amber-700", N: "text-red-700",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function ProbBadge({ value }: { value: number }) {
  const pct = (value * 100).toFixed(1);
  return <span className="font-mono text-xs text-gray-500">{pct}%</span>;
}

function ProbDelta({ before, after }: { before: number; after: number }) {
  const delta = after - before;
  if (Math.abs(delta) < 0.001) return <span className="text-gray-400 text-xs">—</span>;
  const pct = (delta * 100).toFixed(1);
  return (
    <span className={`text-xs font-semibold ${delta > 0 ? "text-emerald-600" : "text-red-500"}`}>
      {delta > 0 ? `+${pct}%` : `${pct}%`}
    </span>
  );
}

// ── Player hand panel ─────────────────────────────────────────────────────────

function PlayerHandPanel({ snap }: { snap: PlayerSnapshot }) {
  return (
    <div className={`rounded-lg border p-3 transition-all ${snap.isActive ? SEAT_BORDER[snap.seat] : "border-gray-200 bg-white"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-bold ${snap.isActive ? SEAT_LABEL_COLOR[snap.seat] : "text-gray-600"}`}>
          {SEAT_LABELS[snap.seat]}
          {snap.isActive && <span className="ml-1 animate-pulse">●</span>}
        </span>
        <ProbBadge value={snap.winProb} />
      </div>
      <div className="flex gap-0.5 flex-wrap min-h-6">
        {snap.hand.map(t => (
          <span
            key={t.id}
            className={`px-1.5 py-0.5 text-xs font-mono rounded font-medium ${SUIT_PILL[t.suit]} ${
              snap.discardedTile?.id === t.id ? "ring-2 ring-red-400 ring-offset-0" : ""
            }`}
          >
            {tileLabel(t.suit, t.val)}
          </span>
        ))}
        {snap.hand.length === 0 && (
          <span className="text-xs text-gray-300 italic">no data</span>
        )}
      </div>
      {snap.isActive && snap.discardedTile && (
        <div className="mt-1.5 text-xs text-gray-500">
          Discards:{" "}
          <span className={`px-1.5 py-0.5 rounded font-mono font-semibold ring-2 ring-red-400 ${SUIT_PILL[snap.discardedTile.suit]}`}>
            {tileLabel(snap.discardedTile.suit, snap.discardedTile.val)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Game list item ────────────────────────────────────────────────────────────

function GameListItem({ game, onSelect }: { game: SavedGame; onSelect: () => void }) {
  const moveCount = game._count?.moves ?? game.moves?.length ?? 0;
  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-700">{game.mode}</span>
        {game.winner
          ? <span className="text-xs text-emerald-600 font-semibold">★ {SEAT_LABELS[game.winner] ?? game.winner}</span>
          : game.finishedAt && <span className="text-xs text-gray-400">draw</span>
        }
      </div>
      <div className="text-xs text-gray-400 mt-0.5">{formatDate(game.createdAt)}</div>
      {moveCount > 0 && <div className="text-xs text-gray-400">{moveCount} moves</div>}
    </button>
  );
}

// ── Move list row ─────────────────────────────────────────────────────────────

function MoveRow({ move, active, onSeek }: { move: SavedMove; active: boolean; onSeek: () => void }) {
  const delta = move.winProbAfter - move.winProbBefore;
  return (
    <button
      onClick={onSeek}
      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
        active ? "bg-indigo-100 border border-indigo-300 text-indigo-800" : "hover:bg-gray-100 text-gray-600 border border-transparent"
      }`}
    >
      <span className="font-mono text-gray-400 mr-1">T{move.turn}</span>
      <span className={`font-semibold mr-1 ${SEAT_LABEL_COLOR[move.player] ?? "text-gray-700"}`}>
        {SEAT_LABELS[move.player] ?? move.player}
      </span>
      <span>{move.action}</span>
      {delta > 0.05 && <span className="ml-1 text-emerald-500">↑</span>}
      {delta < -0.05 && <span className="ml-1 text-red-400">↓</span>}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StudyPage() {
  const {
    games, loadGames, loading, error,
    selectedGame, selectGame, clearGame,
    moves, totalMoves, currentIndex, currentMove,
    playerSnapshots, multiChartData,
    isPlaying, playSpeedMs, setPlaySpeedMs,
    next, prev, seek, play, pause,
    keyMoments,
  } = useStudy();

  const currentTurn = currentMove?.turn ?? -1;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900">Mahjong Trainer</h1>
          <span className="px-2 py-0.5 text-xs rounded-full bg-violet-100 text-violet-700 font-semibold">Study</span>
        </div>
        {selectedGame && (
          <button onClick={clearGame} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1 transition-colors">
            ← All games
          </button>
        )}
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {!selectedGame ? (
          /* ── Game list ───────────────────────────────────────────────────── */
          <div className="max-w-lg mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-800">Saved Games</h2>
              <button onClick={loadGames} disabled={loading} className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40">
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
            {!loading && games.length === 0 && !error && (
              <div className="text-xs text-gray-400 italic text-center py-8">
                No saved games yet. Play a Simulation or Observe game first.
              </div>
            )}
            <div className="space-y-2">
              {games.map(g => <GameListItem key={g.id} game={g} onSelect={() => selectGame(g.id)} />)}
            </div>
          </div>
        ) : (
          /* ── Replay ──────────────────────────────────────────────────────── */
          <div className="grid grid-cols-[200px_1fr] gap-5">

            {/* Left: move list */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Moves ({totalMoves})</div>
              <div className="space-y-0.5 max-h-[calc(100vh-140px)] overflow-y-auto pr-1">
                {moves.map((m, idx) => (
                  <MoveRow key={m.id} move={m} active={idx === currentIndex} onSeek={() => seek(m.turn)} />
                ))}
              </div>
            </div>

            {/* Right: replay content */}
            <div className="space-y-4 min-w-0">

              {/* Win prob chart — all 4 players */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Win Probability — All Players
                </div>
                <WinProbChart multiData={multiChartData} currentTurn={currentTurn} onSeek={seek} />
              </div>

              {/* Playback controls */}
              <div className="bg-white rounded-lg border border-gray-200 px-4 py-2 flex items-center gap-3">
                <button onClick={prev} disabled={currentIndex === 0}
                  className="px-2 py-1 text-xs rounded font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors">
                  ← Prev
                </button>
                {isPlaying
                  ? <button onClick={pause} className="px-3 py-1 text-xs rounded font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors">Pause</button>
                  : <button onClick={play} disabled={currentIndex >= totalMoves - 1}
                      className="px-3 py-1 text-xs rounded font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-30 transition-colors">Play</button>
                }
                <button onClick={next} disabled={currentIndex >= totalMoves - 1}
                  className="px-2 py-1 text-xs rounded font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors">
                  Next →
                </button>
                <div className="h-4 w-px bg-gray-200" />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">Speed</span>
                  {[{ label: "0.5×", ms: 1600 }, { label: "1×", ms: 800 }, { label: "2×", ms: 400 }].map(opt => (
                    <button key={opt.ms} onClick={() => setPlaySpeedMs(opt.ms)}
                      className={`px-2 py-0.5 text-xs rounded font-semibold transition-colors ${
                        playSpeedMs === opt.ms ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="ml-auto text-xs text-gray-400 font-mono">{currentIndex + 1} / {totalMoves}</div>
              </div>

              {/* 4-player hands grid */}
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Hands at Turn {currentTurn >= 0 ? currentTurn : "—"}</div>
                <div className="grid grid-cols-2 gap-3">
                  {playerSnapshots.map(snap => <PlayerHandPanel key={snap.seat} snap={snap} />)}
                </div>
              </div>

              {/* Current move stats */}
              {currentMove && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Move detail</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-bold ${SEAT_LABEL_COLOR[currentMove.player] ?? "text-gray-700"}`}>
                      {SEAT_LABELS[currentMove.player] ?? currentMove.player}
                    </span>
                    <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-700 font-semibold">{currentMove.action}</span>
                    <span className="text-xs text-gray-500 font-mono">T{currentMove.turn}</span>
                    <span className="text-xs text-gray-500">
                      {(currentMove.winProbBefore * 100).toFixed(1)}% → {(currentMove.winProbAfter * 100).toFixed(1)}%
                    </span>
                    <ProbDelta before={currentMove.winProbBefore} after={currentMove.winProbAfter} />
                  </div>
                  {currentMove.commentary && (
                    <div className="text-xs text-gray-600 italic border-l-2 border-indigo-200 pl-2 mt-2">{currentMove.commentary}</div>
                  )}
                </div>
              )}

              {/* Key moments */}
              {(keyMoments.bestDiscard || keyMoments.worstDiscard) && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Key Moments</div>
                  <div className="grid grid-cols-2 gap-4">
                    {keyMoments.bestDiscard && (
                      <div onClick={() => seek(keyMoments.bestDiscard!.turn)}
                        className="rounded border border-emerald-200 bg-emerald-50 p-3 cursor-pointer hover:border-emerald-400 transition-colors">
                        <div className="text-xs font-bold text-emerald-700 mb-1">Best discard</div>
                        <div className="text-xs text-gray-600">T{keyMoments.bestDiscard.turn} — {SEAT_LABELS[keyMoments.bestDiscard.player] ?? keyMoments.bestDiscard.player}</div>
                        <ProbDelta before={keyMoments.bestDiscard.winProbBefore} after={keyMoments.bestDiscard.winProbAfter} />
                      </div>
                    )}
                    {keyMoments.worstDiscard && (
                      <div onClick={() => seek(keyMoments.worstDiscard!.turn)}
                        className="rounded border border-red-200 bg-red-50 p-3 cursor-pointer hover:border-red-400 transition-colors">
                        <div className="text-xs font-bold text-red-600 mb-1">Worst discard</div>
                        <div className="text-xs text-gray-600">T{keyMoments.worstDiscard.turn} — {SEAT_LABELS[keyMoments.worstDiscard.player] ?? keyMoments.worstDiscard.player}</div>
                        <ProbDelta before={keyMoments.worstDiscard.winProbBefore} after={keyMoments.worstDiscard.winProbAfter} />
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
