"use client";

import { useState, useMemo, useCallback } from "react";
import { useObserve } from "@/lib/useObserve";
import type { ObserveSpeed } from "@/lib/useObserve";
import { evaluateHand } from "@/engine/evaluator";
import { tileLabel, sortTiles } from "@/lib/shorthand";
import { DIFFICULTY_PRESETS } from "@/engine/cpu";
import type { DifficultyLevel } from "@/engine/cpu";
import type { PlayerId } from "@/engine/tiles";
import type { Tile, Suit } from "@/engine/tiles";
import PatternTracker from "@/components/PatternTracker";
import { useGameSession } from "@/lib/useGameSession";
import { detectDiscards } from "@/lib/detectDiscards";
import { CHARLESTON_STEPS } from "@/engine/gameEngine";

const SEAT_LABELS: Record<PlayerId, string> = { E: "East", S: "South", W: "West", N: "North" };
const SEAT_ORDER: PlayerId[] = ["E", "S", "W", "N"];

const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const SPEED_OPTIONS: { value: ObserveSpeed; label: string }[] = [
  { value: "step",      label: "Step" },
  { value: "slow",      label: "Slow" },
  { value: "normal",    label: "Normal" },
  { value: "fast",      label: "Fast" },
  { value: "ludicrous", label: "Ludicrous" },
];

const SUIT_PILL: Record<Suit, string> = {
  dots:   "bg-blue-100 text-blue-800",
  bams:   "bg-green-100 text-green-800",
  cracks: "bg-red-100 text-red-800",
  wind:   "bg-yellow-100 text-yellow-800",
  dragon: "bg-purple-100 text-purple-800",
  flower: "bg-pink-100 text-pink-800",
  joker:  "bg-gray-100 text-gray-800",
};

function MiniHand({ tiles, label, isActive, isWinner }: {
  tiles: Tile[];
  label: string;
  isActive: boolean;
  isWinner: boolean;
}) {
  const sorted = useMemo(() => sortTiles(tiles), [tiles]);
  return (
    <div className={`rounded-lg border p-3 transition-all ${
      isWinner ? "border-emerald-400 bg-emerald-50" :
      isActive ? "border-indigo-300 bg-indigo-50" :
      "border-gray-200 bg-white"
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-bold ${isActive ? "text-indigo-700" : "text-gray-600"}`}>
          {label}
          {isActive && <span className="ml-1 text-indigo-500 animate-pulse">●</span>}
          {isWinner && <span className="ml-1 text-emerald-600 font-bold"> ★</span>}
        </span>
        <span className="text-xs text-gray-400">{tiles.length} tiles</span>
      </div>
      <div className="flex gap-0.5 flex-wrap min-h-6">
        {sorted.map(t => (
          <span
            key={t.id}
            className={`px-1.5 py-0.5 text-xs font-mono rounded font-medium ${SUIT_PILL[t.suit]}`}
          >
            {tileLabel(t.suit, t.val)}
          </span>
        ))}
        {tiles.length === 0 && (
          <span className="text-xs text-gray-300 italic">—</span>
        )}
      </div>
    </div>
  );
}

export default function ObservePage() {
  const [difficulty, setDifficulty] = useState<Partial<Record<PlayerId, DifficultyLevel>>>({
    E: "intermediate", S: "intermediate", W: "intermediate", N: "intermediate",
  });

  const { saveMove, finishGame } = useGameSession({ mode: "observe" });

  // Capture moves accurately via onStep callback (works for all speeds including ludicrous)
  const onStep = useCallback((prev: Parameters<typeof detectDiscards>[0], curr: Parameters<typeof detectDiscards>[1]) => {
    if (prev.phase !== "playing") return;
    for (const move of detectDiscards(prev, curr)) {
      saveMove(move);
    }
    if (curr.phase === "finished") {
      finishGame(curr.winner ?? undefined);
    }
  }, [saveMove, finishGame]);

  const { state, speed, setSpeed, paused, togglePause, startGame, step, reset, stats } =
    useObserve({ difficulty, initialSpeed: "normal", onStep });

  // Build eval wall from full game state
  const evalWall = useMemo(() => [
    ...state.wall,
    ...Object.values(state.hands).flat(),
    ...Object.values(state.discardPile).flat(),
    ...Object.values(state.melds).flat().flatMap(m => m.tiles),
  ], [state]);

  // Eval results for all seats — combine in-hand tiles with exposed meld tiles
  const evalResults = useMemo(() =>
    Object.fromEntries(
      SEAT_ORDER.map(seat => {
        const inHand = state.hands[seat] ?? [];
        const meldTiles = (state.melds[seat] ?? []).flatMap(m => m.tiles);
        const fullHand = [...inHand, ...meldTiles];
        return [seat, fullHand.length ? evaluateHand(fullHand, evalWall) : null];
      })
    ) as Record<PlayerId, ReturnType<typeof evaluateHand> | null>,
  [state.hands, state.melds, evalWall]);

  const isPlaying    = state.phase === "playing";
  const isCharleston = state.phase === "charleston";
  const isSetup      = state.phase === "setup";
  const isFinished   = state.phase === "finished";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900">Mahjong Trainer</h1>
          <span className="px-2 py-0.5 text-xs rounded-full bg-teal-100 text-teal-700 font-semibold">
            Observe
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Turn {state.turnNumber}</span>
          {isPlaying && (
            <span className="text-xs text-gray-500">
              {state.wall.length} tiles left
            </span>
          )}
          <button
            onClick={reset}
            className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-2 py-1 transition-colors"
          >
            Reset
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

        {/* Setup */}
        {isSetup && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5 max-w-lg mx-auto">
            <h2 className="text-base font-bold text-gray-800">Set up observation</h2>
            <div className="space-y-3">
              {SEAT_ORDER.map(seat => (
                <div key={seat} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-16">{SEAT_LABELS[seat]}</span>
                  <div className="flex gap-2">
                    {(Object.keys(DIFFICULTY_LABELS) as DifficultyLevel[]).map(level => (
                      <button
                        key={level}
                        onClick={() => setDifficulty(prev => ({ ...prev, [seat]: level }))}
                        className={`px-3 py-1 text-xs rounded-full font-semibold transition-colors ${
                          difficulty[seat] === level
                            ? "bg-teal-600 text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {DIFFICULTY_LABELS[level]}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-gray-400 ml-auto">
                    {DIFFICULTY_PRESETS[difficulty[seat] ?? "intermediate"].name}
                  </span>
                </div>
              ))}
            </div>

            {/* Speed selector */}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <span className="text-sm text-gray-600 w-16">Speed</span>
              <div className="flex gap-2">
                {SPEED_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSpeed(opt.value)}
                    className={`px-3 py-1 text-xs rounded-full font-semibold transition-colors ${
                      speed === opt.value
                        ? "bg-teal-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={startGame}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors"
            >
              Start observation
            </button>
          </div>
        )}

        {/* Finished */}
        {isFinished && stats && (
          <div className={`rounded-lg border p-5 text-center max-w-lg mx-auto ${
            stats.winner ? "bg-emerald-50 border-emerald-300" : "bg-gray-50 border-gray-300"
          }`}>
            <div className="text-xl font-bold mb-1">
              {stats.winner ? `${SEAT_LABELS[stats.winner]} wins` : "No winner — wall exhausted"}
            </div>
            {stats.winningPattern && (
              <div className="text-sm text-gray-600 mb-1">
                Pattern: <strong>{stats.winningPattern}</strong>
              </div>
            )}
            <div className="text-xs text-gray-500 space-x-4">
              <span>{stats.totalTurns} turns</span>
              <span>{stats.wallRemaining} tiles left</span>
            </div>
            <button
              onClick={reset}
              className="mt-4 px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors"
            >
              New game
            </button>
          </div>
        )}

        {/* Charleston banner */}
        {isCharleston && (() => {
          const step = state.charleston?.step ?? 0;
          const info = CHARLESTON_STEPS[step];
          return (
            <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-violet-500 uppercase tracking-wide">
                  Charleston {info?.charleston ?? 1} of 2
                </span>
                <div className="text-sm font-bold text-violet-800">{info?.label ?? ""}</div>
              </div>
              <span className="text-xs text-violet-400">{state.wall.length} tiles in wall</span>
            </div>
          );
        })()}

        {/* Playing */}
        {(isPlaying || isFinished || isCharleston) && (
          <div className="space-y-4">

            {/* Playback controls */}
            {isPlaying && (
              <div className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 px-4 py-2">
                {/* Speed */}
                <div className="flex gap-1">
                  {SPEED_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setSpeed(opt.value)}
                      className={`px-2.5 py-1 text-xs rounded font-semibold transition-colors ${
                        speed === opt.value
                          ? "bg-teal-600 text-white"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="h-4 w-px bg-gray-200" />

                {/* Pause / Step */}
                <button
                  onClick={togglePause}
                  disabled={speed === "step"}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                    speed === "step" ? "opacity-30 cursor-not-allowed bg-gray-100 text-gray-400" :
                    paused ? "bg-teal-600 text-white" : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                  }`}
                >
                  {paused ? "Resume" : "Pause"}
                </button>

                {(speed === "step" || paused) && (
                  <button
                    onClick={step}
                    className="px-3 py-1 text-xs rounded font-semibold bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
                  >
                    Step →
                  </button>
                )}

                <div className="ml-auto text-xs text-gray-500 font-mono">
                  {isPlaying && state.currentSeat && `${SEAT_LABELS[state.currentSeat]}'s turn`}
                </div>
              </div>
            )}

            {/* 4 hands in a 2×2 grid */}
            <div className="grid grid-cols-2 gap-3">
              {SEAT_ORDER.map(seat => (
                <MiniHand
                  key={seat}
                  tiles={state.hands[seat] ?? []}
                  label={`${SEAT_LABELS[seat]} (${DIFFICULTY_LABELS[difficulty[seat] ?? "intermediate"]})`}
                  isActive={state.currentSeat === seat && isPlaying}
                  isWinner={state.winner === seat}
                />
              ))}
            </div>

            {/* Discard rows */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Discards</h2>
              <div className="space-y-1.5">
                {SEAT_ORDER.map(seat => (
                  <div key={seat} className="flex gap-2 items-start">
                    <span className="text-xs text-gray-500 w-16 shrink-0 pt-0.5">{SEAT_LABELS[seat]}</span>
                    <div className="flex gap-0.5 flex-wrap min-h-5">
                      {(state.discardPile[seat] ?? []).map(t => (
                        <span
                          key={t.id}
                          className={`px-1 py-0 text-xs font-mono rounded ${SUIT_PILL[t.suit]}`}
                        >
                          {tileLabel(t.suit, t.val)}
                        </span>
                      ))}
                      {!state.discardPile[seat]?.length && (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pattern trackers — 2×2 grid */}
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Pattern Progress
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {SEAT_ORDER.map(seat => (
                  <div key={seat}>
                    <div className="text-xs font-semibold text-gray-600 mb-1">{SEAT_LABELS[seat]}</div>
                    <PatternTracker
                      hand={state.hands[seat] ?? []}
                      evalResult={evalResults[seat]}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Game log */}
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Game log
              </div>
              <div className="space-y-0.5 max-h-40 overflow-y-auto">
                {[...state.log].reverse().map((entry, i) => (
                  <div key={i} className="text-xs text-gray-600 font-mono leading-relaxed">
                    {entry}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
