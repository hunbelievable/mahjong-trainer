"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import type { GameState } from "@/engine/gameEngine";
import { CHARLESTON_STEPS } from "@/engine/gameEngine";
import { useSimulation } from "@/lib/useSimulation";
import { evaluateHand, bestDiscard } from "@/engine/evaluator";
import { sortTiles } from "@/lib/shorthand";
import type { DifficultyLevel, ClaimType } from "@/engine/cpu";
import { greedyStrategy, chooseTilesForCharleston } from "@/engine/cpu";
import type { PlayerId } from "@/engine/tiles";
import HandDisplay from "@/components/HandDisplay";
import EvalPanel from "@/components/EvalPanel";
import DiscardBoard from "@/components/DiscardBoard";
import PatternTracker from "@/components/PatternTracker";
import TileFace from "@/components/TileFace";
import { useGameSession } from "@/lib/useGameSession";
import { detectDiscards } from "@/lib/detectDiscards";

const SEAT_LABELS: Record<PlayerId, string> = { E: "East", S: "South", W: "West", N: "North" };
const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};
const CLAIM_LABELS: Record<ClaimType, string> = {
  mahjong: "Mahjong!",
  quint: "Quint",
  kong: "Kong",
  pung: "Pung",
};

export default function SimulationPage() {
  const [cpuDifficulty, setCpuDifficulty] = useState<Partial<Record<PlayerId, DifficultyLevel>>>({
    S: "intermediate",
    W: "intermediate",
    N: "intermediate",
  });

  const [sorted, setSorted] = useState(true);
  const [charlestonSelection, setCharlestonSelection] = useState<Set<string>>(new Set());

  const { state, startGame, discard, claim, pass, reset,
          stageCharleston, stopCharleston, beginSecondCharleston, humanSeat } = useSimulation({
    humanSeat: "E",
    cpuDifficulty,
    cpuDelayMs: 500,
  });

  const { saveMove, finishGame } = useGameSession({ mode: "simulation" });

  const rawHand = state.hands[humanSeat] ?? [];
  const humanHand = useMemo(
    () => sorted ? sortTiles(rawHand) : rawHand,
    [rawHand, sorted]
  );

  const evalWall = useMemo(() => Array.from(
    (() => {
      const all = [
        ...state.wall,
        ...Object.values(state.hands).flat(),
        ...Object.values(state.discardPile).flat(),
        ...Object.values(state.melds).flat().flatMap(m => m.tiles),
      ];
      return all;
    })()
  ), [state]);

  // Include exposed meld tiles so the evaluator sees the full committed hand
  const fullHandForEval = useMemo(() => {
    const meldTiles = (state.melds[humanSeat] ?? []).flatMap(m => m.tiles);
    return [...humanHand, ...meldTiles];
  }, [humanHand, state.melds, humanSeat]);

  const evalResult = useMemo(() => {
    if (fullHandForEval.length === 0) return null;
    return evaluateHand(fullHandForEval, evalWall);
  }, [fullHandForEval, evalWall]);

  // Save all players' discards via state diff (catches both human and CPU moves)
  const prevSimStateRef = useRef<GameState | null>(null);
  useEffect(() => {
    const prev = prevSimStateRef.current;
    prevSimStateRef.current = state;
    if (!prev || prev.phase !== "playing") return;

    for (const move of detectDiscards(prev, state)) {
      saveMove(move);
    }
  }, [state, saveMove]);

  // Mark game finished
  const prevPhaseRef = useRef(state.phase);
  useEffect(() => {
    if (prevPhaseRef.current === "playing" && state.phase === "finished") {
      finishGame(state.winner ?? undefined);
    }
    prevPhaseRef.current = state.phase;
  }, [state.phase, state.winner, finishGame]);

  // Charleston coaching: which tiles does the greedy strategy suggest passing?
  const charlestonSuggestedIds = useMemo(() => {
    if (state.phase !== "charleston" || humanHand.length === 0) return new Set<string>();
    const suggested = chooseTilesForCharleston(greedyStrategy, humanHand, state.wall);
    return new Set(suggested.map(t => t.id));
  }, [state.phase, humanHand, state.wall]);

  // Discard coaching: evaluate the full hand (in-hand + melds) but only surface
  // in-hand tiles as discard candidates (you can't discard meld tiles).
  const simDiscardOptions = useMemo(() => {
    if (state.pendingAction?.type !== "human_discard" || humanHand.length === 0) return null;
    return bestDiscard(fullHandForEval, evalWall).filter(o =>
      humanHand.some(t => t.id === o.tile.id)
    );
  }, [state.pendingAction, fullHandForEval, humanHand, evalWall]);

  const simSuggestedDiscardIds = useMemo(() => {
    if (!simDiscardOptions) return new Set<string>();
    const best = simDiscardOptions[0];
    return new Set(
      simDiscardOptions
        .filter(o => o.result.shanten === best.result.shanten && o.result.totalOuts === best.result.totalOuts)
        .map(o => o.tile.id)
    );
  }, [simDiscardOptions]);

  // Clear Charleston selection when step changes
  const charlestonStep = state.charleston?.step ?? -1;
  useEffect(() => {
    setCharlestonSelection(new Set());
  }, [charlestonStep]);

  const toggleCharlestonTile = (tileId: string, isJoker: boolean) => {
    if (isJoker) return;
    setCharlestonSelection(prev => {
      const next = new Set(prev);
      if (next.has(tileId)) {
        next.delete(tileId);
      } else if (next.size < 3) {
        next.add(tileId);
      }
      return next;
    });
  };

  const confirmCharlestonPass = () => {
    if (charlestonSelection.size !== 3) return;
    stageCharleston(Array.from(charlestonSelection));
    setCharlestonSelection(new Set());
  };

  const claimWindow = state.pendingAction?.type === "claim_window"
    ? state.pendingAction
    : null;

  const isHumanTurn = state.pendingAction?.type === "human_discard";
  const isCharlestonPass = state.pendingAction?.type === "human_charleston_pass";
  const isCharlestonStop = state.pendingAction?.type === "human_charleston_stop";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900">Mahjong Trainer</h1>
          <span className="px-2 py-0.5 text-xs rounded-full bg-violet-100 text-violet-700 font-semibold">
            Simulation
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">You: <strong>East</strong></span>
          <span className="text-xs text-gray-500">Turn {state.turnNumber}</span>
          <button
            onClick={reset}
            className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-2 py-1 transition-colors"
          >
            Reset
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* Setup / Game over screens */}
        {state.phase === "setup" && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
            <h2 className="text-base font-bold text-gray-800">Set up game</h2>

            {/* CPU difficulty selectors */}
            <div className="space-y-3">
              {(["S", "W", "N"] as PlayerId[]).map(seat => (
                <div key={seat} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-20">{SEAT_LABELS[seat]}</span>
                  <div className="flex gap-2">
                    {(Object.keys(DIFFICULTY_LABELS) as DifficultyLevel[]).map(level => (
                      <button
                        key={level}
                        onClick={() => setCpuDifficulty(prev => ({ ...prev, [seat]: level }))}
                        className={`
                          px-3 py-1 text-xs rounded-full font-semibold transition-colors
                          ${cpuDifficulty[seat] === level
                            ? "bg-violet-600 text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }
                        `}
                      >
                        {DIFFICULTY_LABELS[level]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={startGame}
              className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-lg transition-colors"
            >
              Deal tiles
            </button>
          </div>
        )}

        {state.phase === "finished" && (
          <div className={`rounded-lg border p-5 text-center ${
            state.winner === humanSeat
              ? "bg-emerald-50 border-emerald-300"
              : state.winner
              ? "bg-red-50 border-red-300"
              : "bg-gray-50 border-gray-300"
          }`}>
            <div className="text-xl font-bold mb-1">
              {state.winner === humanSeat
                ? "You won! 🎉"
                : state.winner
                ? `${SEAT_LABELS[state.winner]} wins`
                : "No winner — wall exhausted"}
            </div>
            {state.winningPattern && (
              <div className="text-sm text-gray-600">
                Winning hand: <strong>{state.winningPattern.name}</strong>
              </div>
            )}
            <button
              onClick={reset}
              className="mt-4 px-6 py-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-lg transition-colors"
            >
              New game
            </button>
          </div>
        )}

        {state.phase === "charleston" && (() => {
          const step = state.charleston?.step ?? 0;
          const stepInfo = CHARLESTON_STEPS[step];
          const dirLabel = stepInfo?.label ?? "";
          const charlNum = stepInfo?.charleston ?? 1;

          // "You are passing to..." from East's perspective
          const EAST_PASSES_TO: Record<"right" | "across" | "left", string> = {
            right: "South",
            across: "West",
            left: "North",
          };
          const passingTo = EAST_PASSES_TO[stepInfo?.direction ?? "right"];

          return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Left: tile passing card */}
              <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-5 space-y-4">
                {/* Header */}
                <div>
                  <div className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-0.5">
                    Charleston {charlNum} of 2
                  </div>
                  <h2 className="text-base font-bold text-gray-800">
                    {dirLabel} — passing to <span className="text-violet-700">{passingTo}</span>
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Select exactly 3 tiles to pass. You cannot pass jokers.
                  </p>
                </div>

                {/* Stop / Continue prompt */}
                {isCharlestonStop && (
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-3">
                    <div className="text-sm font-semibold text-amber-800">
                      First Charleston complete. Begin Second Charleston?
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={beginSecondCharleston}
                        className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded transition-colors"
                      >
                        Yes — Second Charleston
                      </button>
                      <button
                        onClick={stopCharleston}
                        className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold rounded transition-colors"
                      >
                        No — Start playing
                      </button>
                    </div>
                  </div>
                )}

                {/* Tile selection grid */}
                {isCharlestonPass && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {humanHand.map(tile => {
                        const isJoker = tile.suit === "joker";
                        const isSelected = charlestonSelection.has(tile.id);
                        const isSuggested = charlestonSuggestedIds.has(tile.id);
                        const isDisabled = isJoker || (!isSelected && charlestonSelection.size >= 3);
                        return (
                          <div
                            key={tile.id}
                            className={`
                              relative rounded-md p-0.5 transition-all
                              ${isSelected
                                ? "bg-violet-600 ring-2 ring-violet-600 scale-105 shadow-md"
                                : isSuggested && !isDisabled
                                ? "bg-emerald-100 ring-2 ring-emerald-400"
                                : ""
                              }
                            `}
                          >
                            <TileFace
                              suit={tile.suit}
                              val={tile.val}
                              size="sm"
                              dimmed={isDisabled && !isSelected}
                              onClick={isDisabled ? undefined : () => toggleCharlestonTile(tile.id, isJoker)}
                              title={isJoker ? "Jokers cannot be passed" : undefined}
                            />
                            {isSuggested && !isSelected && !isDisabled && (
                              <span className="absolute -top-1.5 -right-1.5 text-[9px] bg-emerald-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold leading-none">
                                ✓
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Legend */}
                    <p className="text-xs text-gray-400">
                      <span className="inline-block w-2 h-2 rounded-sm bg-emerald-400 mr-1 align-middle" />
                      Green = AI suggests passing · Click to select · Purple = your selection
                    </p>

                    <div className="flex items-center gap-4">
                      <span className={`text-sm font-semibold ${
                        charlestonSelection.size === 3 ? "text-violet-700" : "text-gray-500"
                      }`}>
                        {charlestonSelection.size}/3 selected
                      </span>
                      <button
                        onClick={confirmCharlestonPass}
                        disabled={charlestonSelection.size !== 3}
                        className="px-5 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm rounded transition-colors"
                      >
                        Pass tiles →
                      </button>
                    </div>
                  </>
                )}

                <div className="pt-2 border-t border-gray-100">
                  <div className="text-xs text-gray-400">{state.wall.length} tiles in wall</div>
                </div>
              </div>

              {/* Right: pattern alignment panel */}
              <div className="space-y-4">
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Pattern Alignment</h2>
                <EvalPanel result={evalResult} handSize={fullHandForEval.length} />
                <PatternTracker hand={fullHandForEval} evalResult={evalResult} />
              </div>
            </div>
          );
        })()}

        {state.phase === "playing" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Left: hand + claim window + discard board */}
            <div className="lg:col-span-2 space-y-4">

              {/* Claim window */}
              {claimWindow && (
                <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4">
                  <div className="text-sm font-bold text-amber-800 mb-2 flex items-center gap-1.5 flex-wrap">
                    <span>{SEAT_LABELS[claimWindow.discardedBy]} discards</span>
                    <TileFace suit={claimWindow.discard.suit} val={claimWindow.discard.val} size="xs" />
                    <span>— claim it?</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {claimWindow.eligibleTypes.map(ct => (
                      <button
                        key={ct}
                        onClick={() => claim(ct)}
                        className={`
                          px-4 py-1.5 rounded font-bold text-sm transition-colors
                          ${ct === "mahjong"
                            ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                            : "bg-amber-500 hover:bg-amber-600 text-white"
                          }
                        `}
                      >
                        {CLAIM_LABELS[ct]}
                      </button>
                    ))}
                    <button
                      onClick={pass}
                      className="px-4 py-1.5 rounded font-semibold text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors"
                    >
                      Pass
                    </button>
                  </div>
                </div>
              )}

              {/* My Hand */}
              <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Your Hand</h2>
                  <div className="flex items-center gap-3">
                    {/* Sort toggle */}
                    <button
                      onClick={() => setSorted(s => !s)}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                        sorted
                          ? "bg-indigo-100 text-indigo-700 border-indigo-300"
                          : "bg-gray-100 text-gray-500 border-gray-300"
                      }`}
                      title={sorted ? "Showing sorted — click for deal order" : "Showing deal order — click to sort"}
                    >
                      {sorted ? "Sorted" : "Deal order"}
                    </button>
                    {isHumanTurn && (
                      <span className="text-xs text-indigo-600 font-semibold animate-pulse">
                        Your turn — click to discard
                      </span>
                    )}
                    {!isHumanTurn && !claimWindow && state.phase === "playing" && (
                      <span className="text-xs text-gray-400">
                        {SEAT_LABELS[state.currentSeat]}&apos;s turn…
                      </span>
                    )}
                  </div>
                </div>

                <HandDisplay
                  tiles={humanHand}
                  suggestedDiscardIds={isHumanTurn ? simSuggestedDiscardIds : undefined}
                  onTileClick={isHumanTurn ? (tile) => discard(tile.id) : undefined}
                  label=""
                />

                {/* Melds */}
                {state.melds[humanSeat]?.length > 0 && (
                  <div className="pt-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500 font-semibold uppercase">Exposed</span>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {state.melds[humanSeat].map((meld, i) => (
                        <div key={i} className="flex gap-0.5 p-1 rounded bg-indigo-50 border border-indigo-200">
                          {meld.tiles.map(t => (
                            <TileFace key={t.id} suit={t.suit} val={t.val} size="xs" />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Discard Board */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Discards</h2>
                <DiscardBoard
                  discards={state.discardPile}
                  myPosition={humanSeat}
                />
              </div>

              {/* CPU meld summary */}
              {(["S", "W", "N"] as PlayerId[]).some(s => state.melds[s]?.length > 0) && (
                <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                  <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">CPU Exposed Melds</h2>
                  {(["S", "W", "N"] as PlayerId[]).map(seat =>
                    state.melds[seat]?.length > 0 ? (
                      <div key={seat} className="flex items-start gap-2">
                        <span className="text-xs text-gray-500 w-16 shrink-0 pt-0.5">
                          {SEAT_LABELS[seat]}
                        </span>
                        <div className="flex gap-1.5 flex-wrap">
                          {state.melds[seat].map((meld, i) => (
                            <div key={i} className="flex gap-0.5 p-1 rounded bg-gray-50 border border-gray-200">
                              {meld.tiles.map(t => (
                                <TileFace key={t.id} suit={t.suit} val={t.val} size="xs" />
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </div>

            {/* Right: analysis + pattern tracker + game log */}
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Analysis</h2>
              <EvalPanel result={evalResult} handSize={fullHandForEval.length} />
              <PatternTracker hand={fullHandForEval} evalResult={evalResult} />

              {/* Wall count */}
              <div className="text-xs text-gray-500 text-center">
                {state.wall.length} tiles left in wall
              </div>

              {/* Game log */}
              <div className="bg-white rounded-lg border border-gray-200 p-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Game log
                </div>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {[...state.log].reverse().map((entry, i) => (
                    <div key={i} className="text-xs text-gray-600 font-mono leading-relaxed">
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
