"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import type { GameState } from "@/engine/gameEngine";
import { CHARLESTON_STEPS, PASSES_TO, findJokerSwaps } from "@/engine/gameEngine";
import { useSimulation } from "@/lib/useSimulation";
import { evaluateHand, bestDiscard } from "@/engine/evaluator";
import { sortTiles, applyCustomOrder } from "@/lib/shorthand";
import type { DifficultyLevel, ClaimType } from "@/engine/cpu";
import { greedyStrategy, chooseTilesForCharleston } from "@/engine/cpu";
import type { PlayerId } from "@/engine/tiles";
import { SEAT_ORDER } from "@/engine/tiles";
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
    E: "intermediate",
    S: "intermediate",
    W: "intermediate",
    N: "intermediate",
  });
  /** Which seat the human plays. Chosen on the setup screen; East deals/acts first regardless. */
  const [selectedSeat, setSelectedSeat] = useState<PlayerId>("E");

  const [sorted, setSorted] = useState(true);
  /** When on, hand tiles can be dragged to rearrange and discarding is disabled. */
  const [reorderMode, setReorderMode] = useState(false);
  /** User's manual tile arrangement (tile IDs). null = no custom arrangement. */
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  const [coachingEnabled, setCoachingEnabled] = useState(true);
  const [charlestonSelection, setCharlestonSelection] = useState<Set<string>>(new Set());
  /** Tile IDs from the most-recent received pass that the human is passing blind. */
  const [blindSelection, setBlindSelection] = useState<Set<string>>(new Set());
  /** True once the human has chosen to look at received tiles — disables blind passing for this step. */
  const [hasLookedAtReceived, setHasLookedAtReceived] = useState(false);
  /** Tile IDs the human has selected for the courtesy pass. */
  const [courtesySelection, setCourtesySelection] = useState<Set<string>>(new Set());

  const { state, startGame, discard, claim, pass, reset,
          stageCharleston, stopCharleston, beginSecondCharleston,
          respondCourtesy, passCourtesy, swapJoker, humanSeat } = useSimulation({
    humanSeat: selectedSeat,
    cpuDifficulty,
    cpuDelayMs: 500,
  });

  const { saveMove, finishGame } = useGameSession({ mode: "simulation" });

  /** The three CPU seats — everyone except the human, in seat order. */
  const cpuSeats = useMemo(() => SEAT_ORDER.filter(s => s !== humanSeat), [humanSeat]);

  const rawHand = state.hands[humanSeat] ?? [];
  const handIdsKey = rawHand.map(t => t.id).join(",");
  const humanHand = useMemo(
    () => {
      if (customOrder) return applyCustomOrder(customOrder, rawHand);
      return sorted ? sortTiles(rawHand) : rawHand;
    },
    // handIdsKey captures membership changes; rawHand ref is stable between them
    [handIdsKey, sorted, customOrder] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Keep the custom arrangement reconciled as the hand changes (draws/discards).
  useEffect(() => {
    if (!customOrder) return;
    const reconciled = applyCustomOrder(customOrder, rawHand).map(t => t.id);
    if (
      reconciled.length !== customOrder.length ||
      reconciled.some((id, i) => id !== customOrder[i])
    ) {
      setCustomOrder(reconciled);
    }
  }, [handIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const enterReorder = () => {
    setCustomOrder(humanHand.map(t => t.id));
    setReorderMode(true);
  };
  const resetOrder = () => {
    setCustomOrder(null);
    setReorderMode(false);
  };

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
    if (!coachingEnabled || state.phase !== "charleston" || humanHand.length === 0) return new Set<string>();
    const suggested = chooseTilesForCharleston(greedyStrategy, humanHand, state.wall);
    return new Set(suggested.map(t => t.id));
  }, [coachingEnabled, state.phase, humanHand, state.wall]);

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
    setBlindSelection(new Set());
    setHasLookedAtReceived(false);
  }, [charlestonStep]);

  // Clear courtesy selection when its phase changes
  useEffect(() => {
    if (state.pendingAction?.type !== "human_courtesy_select") {
      setCourtesySelection(new Set());
    }
  }, [state.pendingAction]);

  /** Blind pass is offered on Charleston steps 2 (First-Left) and 5 (Second-Right). */
  const blindAllowed = charlestonStep === 2 || charlestonStep === 5;
  const receivedIds = useMemo(
    () => (blindAllowed ? state.charleston?.lastReceived?.[humanSeat] ?? [] : []),
    [blindAllowed, state.charleston, humanSeat]
  );

  const toggleCharlestonTile = (tileId: string, isJoker: boolean) => {
    if (isJoker) return;
    setCharlestonSelection(prev => {
      const next = new Set(prev);
      const totalSelected = next.size + blindSelection.size;
      if (next.has(tileId)) {
        next.delete(tileId);
      } else if (totalSelected < 3) {
        next.add(tileId);
      }
      return next;
    });
  };

  const toggleBlindTile = (tileId: string) => {
    setBlindSelection(prev => {
      const next = new Set(prev);
      const totalSelected = next.size + charlestonSelection.size;
      if (next.has(tileId)) {
        next.delete(tileId);
      } else if (totalSelected < 3) {
        next.add(tileId);
      }
      return next;
    });
  };

  const confirmCharlestonPass = () => {
    const total = charlestonSelection.size + blindSelection.size;
    if (total !== 3) return;
    stageCharleston([...Array.from(charlestonSelection), ...Array.from(blindSelection)]);
    setCharlestonSelection(new Set());
    setBlindSelection(new Set());
    setHasLookedAtReceived(false);
  };

  const toggleCourtesyTile = (tileId: string, isJoker: boolean, max: number) => {
    if (isJoker) return;
    setCourtesySelection(prev => {
      const next = new Set(prev);
      if (next.has(tileId)) {
        next.delete(tileId);
      } else if (next.size < max) {
        next.add(tileId);
      }
      return next;
    });
  };

  const confirmCourtesyPass = (count: number) => {
    if (courtesySelection.size !== count) return;
    passCourtesy(Array.from(courtesySelection));
    setCourtesySelection(new Set());
  };

  const claimWindow = state.pendingAction?.type === "claim_window"
    ? state.pendingAction
    : null;

  const isHumanTurn = state.pendingAction?.type === "human_discard";
  const isCharlestonPass = state.pendingAction?.type === "human_charleston_pass";
  const isCharlestonStop = state.pendingAction?.type === "human_charleston_stop";
  const courtesyProposeAction = state.pendingAction?.type === "human_courtesy_propose"
    ? state.pendingAction
    : null;
  const courtesySelectAction = state.pendingAction?.type === "human_courtesy_select"
    ? state.pendingAction
    : null;

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
          <span className="text-xs text-gray-500">You: <strong>{SEAT_LABELS[humanSeat]}</strong></span>
          <span className="text-xs text-gray-500">Turn {state.turnNumber}</span>
          <button
            onClick={() => setCoachingEnabled(c => !c)}
            className={`text-xs rounded px-2 py-1 border transition-colors ${
              coachingEnabled
                ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                : "bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100"
            }`}
            title="Show or hide AI suggestions for Charleston passes and discards"
          >
            Coaching {coachingEnabled ? "On" : "Off"}
          </button>
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

            {/* Seat selector */}
            <div className="space-y-2">
              <span className="text-sm font-semibold text-gray-700">Your seat</span>
              <div className="flex gap-2">
                {SEAT_ORDER.map(seat => (
                  <button
                    key={seat}
                    onClick={() => setSelectedSeat(seat)}
                    className={`
                      px-3 py-1 text-xs rounded-full font-semibold transition-colors
                      ${selectedSeat === seat
                        ? "bg-violet-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }
                    `}
                  >
                    {SEAT_LABELS[seat]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">East deals and plays first regardless of your seat.</p>
            </div>

            {/* CPU difficulty selectors */}
            <div className="space-y-3">
              <span className="text-sm font-semibold text-gray-700">Opponent difficulty</span>
              {cpuSeats.map(seat => (
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

          // Recipient of this pass, relative to the human's seat.
          const passingTo = SEAT_LABELS[PASSES_TO[stepInfo?.direction ?? "right"][humanSeat]];

          return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Left: tile passing card */}
              <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-5 space-y-4">
                {/* Header — only when actually picking tiles to pass */}
                {isCharlestonPass && (
                  <div>
                    <div className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-0.5">
                      Charleston {charlNum} of 2
                    </div>
                    <h2 className="text-base font-bold text-gray-800">
                      {dirLabel} — passing to <span className="text-violet-700">{passingTo}</span>
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Select exactly 3 tiles to pass. You cannot pass jokers.
                      {blindAllowed && " You may include just-received tiles blind."}
                    </p>
                  </div>
                )}

                {/* Stop / Continue vote */}
                {isCharlestonStop && state.pendingAction?.type === "human_charleston_stop" && (() => {
                  const cpuVotes = state.pendingAction.cpuVotes;
                  const anyCpuSkips = cpuSeats.some(s => cpuVotes[s]);
                  return (
                    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-3">
                      <div className="text-sm font-semibold text-amber-800">
                        First Charleston complete. Play the Second Charleston?
                      </div>
                      <div className="text-xs text-amber-900 space-y-0.5">
                        <div className="font-medium">Opponent votes:</div>
                        {cpuSeats.map(seat => (
                          <div key={seat} className="ml-2">
                            • {SEAT_LABELS[seat]}: {cpuVotes[seat]
                              ? <span className="text-rose-700 font-semibold">votes to skip</span>
                              : <span className="text-violet-700 font-semibold">wants to play</span>}
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-amber-700 italic">
                        {anyCpuSkips
                          ? "At least one opponent votes to skip — Second Charleston will end whether you play or not."
                          : "All opponents want to play. Your vote decides: vote to skip and the Second Charleston ends."}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={beginSecondCharleston}
                          className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded transition-colors"
                        >
                          Play Second Charleston
                        </button>
                        <button
                          onClick={stopCharleston}
                          className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold rounded transition-colors"
                        >
                          Vote to skip
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Blind-pass section (only steps 2 and 5) */}
                {isCharlestonPass && blindAllowed && receivedIds.length > 0 && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                          Just received
                        </div>
                        <p className="text-xs text-indigo-600 mt-0.5">
                          {hasLookedAtReceived
                            ? "Revealed — include them with the rest of your hand below."
                            : "You can pass any of these forward without looking. Click a tile to include it blind."}
                        </p>
                      </div>
                      {!hasLookedAtReceived && (
                        <button
                          onClick={() => { setHasLookedAtReceived(true); setBlindSelection(new Set()); }}
                          className="text-xs px-2 py-1 rounded bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 transition-colors"
                        >
                          Look at received
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {receivedIds.map(tileId => {
                        const isBlind = blindSelection.has(tileId);
                        if (hasLookedAtReceived) {
                          // Once revealed, find the actual tile in hand and show face-up; user picks from main grid.
                          const tile = humanHand.find(t => t.id === tileId);
                          if (!tile) return null;
                          return (
                            <TileFace
                              key={tileId}
                              suit={tile.suit}
                              val={tile.val}
                              size="sm"
                              title="Already revealed — select from your hand below"
                            />
                          );
                        }
                        return (
                          <button
                            key={tileId}
                            type="button"
                            onClick={() => toggleBlindTile(tileId)}
                            className={`
                              w-9 h-12 inline-flex items-center justify-center
                              rounded-md border-2 transition-all
                              shadow-[0_1px_0_#bdb39a,0_2px_3px_rgba(0,0,0,0.18)]
                              ${isBlind
                                ? "bg-indigo-600 border-indigo-700 text-white scale-105"
                                : "bg-indigo-100 border-indigo-300 text-indigo-500 hover:bg-indigo-200"}
                            `}
                            title={isBlind ? "Will be passed blind — click to unselect" : "Click to pass blind"}
                          >
                            <span className="text-xl font-bold leading-none">?</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Tile selection grid */}
                {isCharlestonPass && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {humanHand
                        .filter(tile => {
                          // Hide received tiles from the face-up grid until the user reveals them.
                          if (blindAllowed && !hasLookedAtReceived && receivedIds.includes(tile.id)) return false;
                          return true;
                        })
                        .map(tile => {
                        const isJoker = tile.suit === "joker";
                        const isSelected = charlestonSelection.has(tile.id);
                        const isSuggested = charlestonSuggestedIds.has(tile.id);
                        const totalSelected = charlestonSelection.size + blindSelection.size;
                        const isDisabled = isJoker || (!isSelected && totalSelected >= 3);
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
                      {coachingEnabled && (
                        <>
                          <span className="inline-block w-2 h-2 rounded-sm bg-emerald-400 mr-1 align-middle" />
                          Green = AI suggests passing ·{" "}
                        </>
                      )}
                      Click to select · Purple = your selection
                    </p>

                    <div className="flex items-center gap-4">
                      <span className={`text-sm font-semibold ${
                        charlestonSelection.size + blindSelection.size === 3 ? "text-violet-700" : "text-gray-500"
                      }`}>
                        {charlestonSelection.size + blindSelection.size}/3 selected
                        {blindSelection.size > 0 && (
                          <span className="ml-1 text-xs text-indigo-600">
                            ({blindSelection.size} blind)
                          </span>
                        )}
                      </span>
                      <button
                        onClick={confirmCharlestonPass}
                        disabled={charlestonSelection.size + blindSelection.size !== 3}
                        className="px-5 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm rounded transition-colors"
                      >
                        Pass tiles →
                      </button>
                    </div>
                  </>
                )}

                {/* Courtesy pass — proposal step */}
                {courtesyProposeAction && (
                  <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-rose-700 uppercase tracking-wide mb-0.5">
                        Courtesy pass
                      </div>
                      <h2 className="text-base font-bold text-gray-800">
                        {SEAT_LABELS[courtesyProposeAction.acrossSeat]} proposes
                        {" "}
                        <span className="text-rose-700">
                          {courtesyProposeAction.cpuProposal === 0
                            ? "no exchange"
                            : `${courtesyProposeAction.cpuProposal} tile${courtesyProposeAction.cpuProposal === 1 ? "" : "s"}`}
                        </span>
                      </h2>
                      <p className="text-xs text-gray-600 mt-1">
                        Pick your count — the lower of the two is what you actually exchange. Pick 0 to decline.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {[0, 1, 2, 3].map(n => (
                        <button
                          key={n}
                          onClick={() => respondCourtesy(n)}
                          className="w-12 h-12 rounded border border-rose-300 bg-white hover:bg-rose-100 text-rose-700 font-bold text-lg transition-colors"
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Courtesy pass — tile selection step */}
                {courtesySelectAction && (
                  <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-rose-700 uppercase tracking-wide mb-0.5">
                        Courtesy pass
                      </div>
                      <h2 className="text-base font-bold text-gray-800">
                        Pick {courtesySelectAction.count} tile{courtesySelectAction.count === 1 ? "" : "s"} to exchange with {SEAT_LABELS[courtesySelectAction.acrossSeat]}
                      </h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {humanHand.map(tile => {
                        const isJoker = tile.suit === "joker";
                        const isSelected = courtesySelection.has(tile.id);
                        const isDisabled = isJoker || (!isSelected && courtesySelection.size >= courtesySelectAction.count);
                        return (
                          <div
                            key={tile.id}
                            className={`relative rounded-md p-0.5 transition-all ${
                              isSelected ? "bg-rose-600 ring-2 ring-rose-600 scale-105 shadow-md" : ""
                            }`}
                          >
                            <TileFace
                              suit={tile.suit}
                              val={tile.val}
                              size="sm"
                              dimmed={isDisabled && !isSelected}
                              onClick={isDisabled ? undefined : () => toggleCourtesyTile(tile.id, isJoker, courtesySelectAction.count)}
                              title={isJoker ? "Jokers cannot be passed" : undefined}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`text-sm font-semibold ${
                        courtesySelection.size === courtesySelectAction.count ? "text-rose-700" : "text-gray-500"
                      }`}>
                        {courtesySelection.size}/{courtesySelectAction.count} selected
                      </span>
                      <button
                        onClick={() => confirmCourtesyPass(courtesySelectAction.count)}
                        disabled={courtesySelection.size !== courtesySelectAction.count}
                        className="px-5 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm rounded transition-colors"
                      >
                        Exchange →
                      </button>
                    </div>
                  </div>
                )}

                {/* Read-only hand reference — shown during the stop vote and courtesy propose
                    screens so the player can see what they have while deciding. */}
                {(isCharlestonStop || courtesyProposeAction) && (
                  <div className="pt-3 border-t border-gray-100 space-y-1">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Your hand
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {humanHand.map(tile => (
                        <TileFace key={tile.id} suit={tile.suit} val={tile.val} size="sm" />
                      ))}
                    </div>
                  </div>
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
                    {reorderMode ? (
                      <>
                        <span className="text-xs px-2 py-0.5 rounded border bg-amber-100 text-amber-800 border-amber-300 font-semibold">
                          Reorder mode — drag tiles, discarding off
                        </span>
                        <button
                          onClick={() => setReorderMode(false)}
                          className="text-xs px-2 py-0.5 rounded border bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 transition-colors"
                          title="Finish reordering and re-enable discarding"
                        >
                          Done
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Order toggle */}
                        {customOrder ? (
                          <button
                            onClick={resetOrder}
                            className="text-xs px-2 py-0.5 rounded border bg-emerald-100 text-emerald-700 border-emerald-300 transition-colors"
                            title="Custom arrangement — click to reset to sorted"
                          >
                            Custom ✕
                          </button>
                        ) : (
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
                        )}
                        {/* Reorder toggle */}
                        <button
                          onClick={enterReorder}
                          className="text-xs px-2 py-0.5 rounded border bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200 transition-colors"
                          title="Drag tiles to rearrange your hand"
                        >
                          Reorder
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
                      </>
                    )}
                  </div>
                </div>

                {/* Joker swap opportunities — only on your turn */}
                {isHumanTurn && (() => {
                  const swaps = findJokerSwaps(state, humanSeat);
                  // Dedupe by (meldOwnerSeat, meldIndex, jokerTileId) — only the first natural is offered per joker.
                  const seen = new Set<string>();
                  const unique = swaps.filter(s => {
                    const key = `${s.meldOwnerSeat}:${s.meldIndex}:${s.jokerTile.id}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                  });
                  if (unique.length === 0) return null;
                  return (
                    <div className="rounded-lg border border-purple-200 bg-purple-50/60 p-3 space-y-2">
                      <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide">
                        Joker swap available
                      </div>
                      <p className="text-xs text-purple-700">
                        You can swap a natural tile from your hand for a joker exposed in someone's meld.
                      </p>
                      <div className="space-y-1.5">
                        {unique.map((s, i) => (
                          <div key={i} className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-gray-600 w-14 shrink-0">
                              {s.meldOwnerSeat === humanSeat ? "Your" : `${SEAT_LABELS[s.meldOwnerSeat]}'s`}
                            </span>
                            <span className="text-xs text-gray-500">give</span>
                            <TileFace suit={s.handTile.suit} val={s.handTile.val} size="xs" />
                            <span className="text-xs text-gray-500">for</span>
                            <TileFace suit="joker" val="joker" size="xs" />
                            <button
                              onClick={() => swapJoker({
                                meldOwnerSeat: s.meldOwnerSeat,
                                meldIndex: s.meldIndex,
                                jokerTileId: s.jokerTile.id,
                                handTileId: s.handTile.id,
                              })}
                              className="ml-auto px-2 py-0.5 text-xs font-semibold rounded bg-purple-600 hover:bg-purple-700 text-white transition-colors"
                            >
                              Swap
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <HandDisplay
                  tiles={humanHand}
                  reorderable={reorderMode}
                  onReorder={setCustomOrder}
                  suggestedDiscardIds={!reorderMode && isHumanTurn && coachingEnabled ? simSuggestedDiscardIds : undefined}
                  freshTileId={
                    !reorderMode && isHumanTurn && state.lastDraw?.seat === humanSeat
                      ? state.lastDraw.tileId
                      : undefined
                  }
                  onTileClick={!reorderMode && isHumanTurn ? (tile) => discard(tile.id) : undefined}
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
              {cpuSeats.some(s => state.melds[s]?.length > 0) && (
                <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                  <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">CPU Exposed Melds</h2>
                  {cpuSeats.map(seat =>
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
