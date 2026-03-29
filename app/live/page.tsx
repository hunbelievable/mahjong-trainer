"use client";

import { useReducer, useMemo, useState, useRef, useCallback } from "react";
import {
  createInitialState,
  liveGameReducer,
  tilesFromIds,
  buildEvalWall,
} from "@/lib/liveGame";
import type { LiveGameAction } from "@/lib/liveGame";
import { parseShorthand, ALL_TILE_TYPES, tileLabel } from "@/lib/shorthand";
import type { TileType } from "@/lib/shorthand";
import { evaluateHand, bestDiscard } from "@/engine/evaluator";
import { greedyStrategy, chooseTilesForCharleston } from "@/engine/cpu";
import type { Tile, PlayerId } from "@/engine/tiles";
import { useGameSession } from "@/lib/useGameSession";
import TilePicker from "@/components/TilePicker";
import HandDisplay from "@/components/HandDisplay";
import DiscardBoard from "@/components/DiscardBoard";
import EvalPanel from "@/components/EvalPanel";

const SEATS: PlayerId[] = ["E", "S", "W", "N"];
const SEAT_LABELS: Record<PlayerId, string> = { E: "East", S: "South", W: "West", N: "North" };

export default function LivePage() {
  const [state, dispatch] = useReducer(liveGameReducer, undefined, () =>
    createInitialState("E")
  );
  const { saveMove } = useGameSession({ mode: "live" });

  // Coaching toggle
  const [coachingEnabled, setCoachingEnabled] = useState(true);

  // Shorthand input for hand
  const [handInput, setHandInput] = useState("");
  const [handInputError, setHandInputError] = useState("");
  const handInputRef = useRef<HTMLInputElement>(null);

  // Shorthand input for discards — per-player
  const [discardInputs, setDiscardInputs] = useState<Record<PlayerId, string>>({
    E: "", S: "", W: "", N: "",
  });
  const [activeDiscardSeat, setActiveDiscardSeat] = useState<PlayerId>("S");

  // Derive tile arrays
  const hand = useMemo(() => tilesFromIds(state, state.handIds), [state]);
  const discards = useMemo(
    () =>
      Object.fromEntries(
        SEATS.map(s => [s, tilesFromIds(state, state.discardIds[s])])
      ) as Record<PlayerId, Tile[]>,
    [state]
  );
  const evalWall = useMemo(() => buildEvalWall(state), [state]);

  // Evaluator — run on every state change
  const evalResult = useMemo(() => {
    if (hand.length === 0) return null;
    return evaluateHand(hand, evalWall);
  }, [hand, evalWall]);

  // Discard suggestions — only when hand has 14 tiles
  const discardOptions = useMemo(() => {
    if (hand.length !== 14) return null;
    return bestDiscard(hand, evalWall);
  }, [hand, evalWall]);

  const suggestedDiscardIds = useMemo(() => {
    if (!discardOptions) return new Set<string>();
    const best = discardOptions[0];
    // Highlight all tiles tied for best
    return new Set(
      discardOptions
        .filter(
          o =>
            o.result.shanten === best.result.shanten &&
            o.result.totalOuts === best.result.totalOuts
        )
        .map(o => o.tile.id)
    );
  }, [discardOptions]);

  // Charleston coaching — suggest 3 tiles to pass when hand has 3–13 tiles
  const charlestonAdvice = useMemo(() => {
    if (!coachingEnabled || hand.length < 3 || hand.length > 13) return null;
    return chooseTilesForCharleston(greedyStrategy, hand, evalWall);
  }, [coachingEnabled, hand, evalWall]);

  // Exhausted tile keys (all copies used)
  const exhaustedKeys = useMemo(() => {
    const out = new Set<string>();
    for (const tileType of ALL_TILE_TYPES) {
      const maxCopies =
        tileType.suit === "flower" || tileType.suit === "joker" ? 8 : 4;
      let usedCount = 0;
      for (let copy = 1; copy <= maxCopies; copy++) {
        const tile = state.registry.get(
          `${tileType.suit}_${tileType.val}_${copy}`
        );
        if (tile && tile.state !== "in_wall") usedCount++;
      }
      if (usedCount >= maxCopies) out.add(`${tileType.suit}:${tileType.val}`);
    }
    return out;
  }, [state]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const addTileToHand = useCallback(
    (tile: TileType) => {
      if (state.handIds.length >= 14) return;
      dispatch({ type: "ADD_TO_HAND", suit: tile.suit, val: tile.val } as LiveGameAction);
    },
    [state.handIds.length]
  );

  const handleHandInput = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      const parsed = parseShorthand(handInput);
      if (!parsed) {
        setHandInputError(`Unknown tile: "${handInput}"`);
        return;
      }
      setHandInputError("");
      setHandInput("");
      dispatch({ type: "ADD_TO_HAND", suit: parsed.suit, val: parsed.val });
      handInputRef.current?.focus();
    },
    [handInput]
  );

  const handleDiscardInput = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, seat: PlayerId) => {
      if (e.key !== "Enter") return;
      const raw = discardInputs[seat];
      const parsed = parseShorthand(raw);
      if (!parsed) return;
      setDiscardInputs(prev => ({ ...prev, [seat]: "" }));
      dispatch({ type: "ADD_DISCARD", suit: parsed.suit, val: parsed.val, player: seat });
      // Advance to next seat in turn order
      const nextSeat = SEATS[(SEATS.indexOf(seat) + 1) % SEATS.length];
      setActiveDiscardSeat(nextSeat);
    },
    [discardInputs]
  );

  const handleTileClick = useCallback(
    (tile: Tile) => {
      if (hand.length === 14) {
        // Save the move before dispatching so we capture winProb from current eval
        if (evalResult) {
          const probAfterDiscard =
            discardOptions?.find(o => o.tile.id === tile.id)?.result.winProbability ?? 0;
          saveMove({
            player: state.myPosition,
            action: "discard",
            tileId: tile.id,
            handBefore: state.handIds,
            winProbBefore: evalResult.winProbability,
            winProbAfter: probAfterDiscard,
            tileEvents: [{
              tileId: tile.id,
              fromState: "in_hand",
              toState: "discarded",
              actor: state.myPosition,
            }],
          });
        }
        dispatch({ type: "DISCARD", tileId: tile.id, player: state.myPosition });
      } else {
        dispatch({ type: "REMOVE_FROM_HAND", tileId: tile.id });
      }
    },
    [hand.length, state.myPosition, state.handIds, evalResult, discardOptions, saveMove]
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900">Mahjong Trainer</h1>
          <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-700 font-semibold">
            Live
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            Your seat: <strong>{SEAT_LABELS[state.myPosition]}</strong>
          </span>
          <button
            onClick={() => setCoachingEnabled(e => !e)}
            className={`text-xs border rounded px-2 py-1 transition-colors font-medium ${
              coachingEnabled
                ? "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200"
                : "bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200"
            }`}
          >
            Coaching {coachingEnabled ? "On" : "Off"}
          </button>
          <button
            onClick={() => dispatch({ type: "RESET" })}
            className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-2 py-1 transition-colors"
          >
            Reset game
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left column: hand + eval */}
        <div className="lg:col-span-2 space-y-5">

          {/* My Hand */}
          <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">My Hand</h2>

            <HandDisplay
              tiles={hand}
              suggestedDiscardIds={suggestedDiscardIds}
              onTileClick={handleTileClick}
              label={hand.length === 14 ? "Click a tile to discard it" : "Hand"}
            />

            {hand.length === 14 && (
              <p className="text-xs text-orange-600 font-medium">
                14 tiles — click the highlighted tile (or any tile) to discard
              </p>
            )}

            {/* Shorthand input */}
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <input
                  ref={handInputRef}
                  type="text"
                  value={handInput}
                  onChange={e => {
                    setHandInput(e.target.value);
                    setHandInputError("");
                  }}
                  onKeyDown={handleHandInput}
                  placeholder='Type shorthand + Enter  e.g. "5d"  "e"  "red"  "jkr"'
                  className="w-full text-sm font-mono border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  disabled={hand.length >= 14}
                />
                {handInputError && (
                  <p className="text-xs text-red-500 mt-0.5">{handInputError}</p>
                )}
              </div>
            </div>

            {/* Tile picker */}
            <details className="group">
              <summary className="cursor-pointer text-xs text-indigo-600 hover:text-indigo-800 font-medium select-none">
                Tile picker ▸
              </summary>
              <div className="mt-2 pt-2 border-t border-gray-100">
                <TilePicker onPick={addTileToHand} exhaustedKeys={exhaustedKeys} />
              </div>
            </details>
          </section>

          {/* Discard Board */}
          <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Discard Board</h2>

            <DiscardBoard
              discards={discards}
              myPosition={state.myPosition}
              onRemove={(tile, player) =>
                dispatch({ type: "REMOVE_DISCARD", tileId: tile.id, player })
              }
            />

            {/* Per-player discard input */}
            <div className="pt-2 border-t border-gray-100">
              <div className="flex gap-1 mb-2">
                {SEATS.map(seat => (
                  <button
                    key={seat}
                    onClick={() => setActiveDiscardSeat(seat)}
                    className={`
                      px-3 py-1 text-xs rounded font-semibold transition-colors
                      ${activeDiscardSeat === seat
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }
                    `}
                  >
                    {SEAT_LABELS[seat]}{seat === state.myPosition ? " ★" : ""}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={discardInputs[activeDiscardSeat]}
                onChange={e =>
                  setDiscardInputs(prev => ({
                    ...prev,
                    [activeDiscardSeat]: e.target.value,
                  }))
                }
                onKeyDown={e => handleDiscardInput(e, activeDiscardSeat)}
                placeholder={`${SEAT_LABELS[activeDiscardSeat]} discarded... (Enter to add)`}
                className="w-full text-sm font-mono border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </section>
        </div>

        {/* Right column: eval panel */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Analysis</h2>

          {/* Charleston coaching panel */}
          {charlestonAdvice && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                Charleston Coach
              </div>
              <p className="text-xs text-emerald-600">
                Suggested tiles to pass ({hand.length} tiles in hand):
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {charlestonAdvice.map(tile => (
                  <span
                    key={tile.id}
                    className="px-2 py-1 text-sm font-mono font-semibold rounded bg-emerald-600 text-white"
                  >
                    {tileLabel(tile.suit, tile.val)}
                  </span>
                ))}
              </div>
              <p className="text-xs text-emerald-500 leading-relaxed">
                Passing these leaves your hand closest to a winning pattern.
              </p>
            </div>
          )}

          <EvalPanel result={evalResult} handSize={hand.length} />

          {/* Shorthand reference */}
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-700 font-medium select-none">
              Shorthand reference ▸
            </summary>
            <div className="mt-2 space-y-0.5 leading-relaxed">
              <div><code className="font-mono">1d–9d</code> Dots</div>
              <div><code className="font-mono">1b–9b</code> Bams</div>
              <div><code className="font-mono">1c–9c</code> Cracks</div>
              <div><code className="font-mono">e s w n</code> Winds</div>
              <div><code className="font-mono">r / g / wh</code> Dragons (Red/Grn/Wht)</div>
              <div><code className="font-mono">f</code> Flower &nbsp;·&nbsp; <code className="font-mono">j</code> Joker</div>
            </div>
          </details>
        </div>

      </div>
    </div>
  );
}
