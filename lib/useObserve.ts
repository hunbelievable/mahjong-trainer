"use client";

import { useReducer, useCallback, useEffect, useRef, useState } from "react";
import { createGameState, gameReducer } from "@/engine/gameEngine";
import type { GameState, GameAction, EngineContext } from "@/engine/gameEngine";
import { PATTERNS } from "@/engine/patterns";
import { DIFFICULTY_PRESETS, chooseTilesForCharleston } from "@/engine/cpu";
import type { DifficultyLevel, SeatStrategies } from "@/engine/cpu";
import { evaluateHand } from "@/engine/evaluator";
import type { PlayerId } from "@/engine/tiles";

export type ObserveSpeed = "step" | "slow" | "normal" | "fast" | "ludicrous";

const SPEED_DELAY_MS: Record<ObserveSpeed, number> = {
  step:     0,     // manual only
  slow:     1200,
  normal:   500,
  fast:     150,
  ludicrous: 0,   // fires RUN_TO_COMPLETION — entire game in one reducer call
};

export interface ObserveOptions {
  difficulty?: Partial<Record<PlayerId, DifficultyLevel>>;
  initialSpeed?: ObserveSpeed;
  /** Called for every individual state transition (prev → curr). Use for accurate move capture. */
  onStep?: (prev: GameState, curr: GameState) => void;
}

export interface ObserveStats {
  totalTurns: number;
  winner: PlayerId | null;
  winningPattern: string | null;
  wallRemaining: number;
}

export function useObserve(options: ObserveOptions = {}) {
  const { difficulty = {}, initialSpeed = "normal", onStep } = options;
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const [speed, setSpeed] = useState<ObserveSpeed>(initialSpeed);
  const [paused, setPaused] = useState(false);
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  speedRef.current = speed;
  pausedRef.current = paused;

  // Build strategies for all 4 seats
  const strategiesRef = useRef<SeatStrategies>({});
  useEffect(() => {
    const s: SeatStrategies = {};
    for (const seat of ["E", "S", "W", "N"] as PlayerId[]) {
      const level = (difficulty[seat] ?? "intermediate") as DifficultyLevel;
      s[seat] = DIFFICULTY_PRESETS[level];
    }
    strategiesRef.current = s;
  }, [difficulty]);

  // Use "Z" as a sentinel humanSeat so no seat is treated as human
  // The engine guard we added handles unknown humanSeat gracefully
  const OBSERVER_SEAT: PlayerId = "E"; // doesn't matter — we'll auto-resolve all pending actions

  function getCtx(): EngineContext {
    return {
      humanSeat: OBSERVER_SEAT,
      humanSeats: new Set([OBSERVER_SEAT]),
      strategies: strategiesRef.current,
      patterns: PATTERNS,
    };
  }

  const [state, rawDispatch] = useReducer(
    (s: GameState, a: GameAction) => gameReducer(s, a, getCtx()),
    undefined,
    createGameState
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = useCallback((action: GameAction) => rawDispatch(action), []);

  // ── Auto-advance logic ────────────────────────────────────────────────────

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Compute the next action to dispatch based on current state.
   * Returns null if the game is done or waiting for manual step.
   */
  const getNextAction = useCallback((): GameAction | null => {
    const s = stateRef.current;

    // Charleston phase: auto-drive the observer seat
    if (s.phase === "charleston") {
      if (s.pendingAction?.type === "human_charleston_pass") {
        const hand = s.hands[OBSERVER_SEAT];
        const strategy = strategiesRef.current[OBSERVER_SEAT] ?? DIFFICULTY_PRESETS.intermediate;
        const tiles = chooseTilesForCharleston(strategy, hand, s.wall, PATTERNS);
        return { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles.map(t => t.id) };
      }
      if (s.pendingAction?.type === "human_charleston_stop") {
        return { type: "BEGIN_SECOND_CHARLESTON" };
      }
      // No real observer to negotiate courtesy — always decline (count 0).
      if (s.pendingAction?.type === "human_courtesy_propose") {
        return { type: "HUMAN_COURTESY_RESPOND", count: 0 };
      }
      if (s.pendingAction?.type === "human_courtesy_select") {
        return { type: "HUMAN_COURTESY_PASS", tileIds: [] };
      }
      return null;
    }

    if (s.phase !== "playing") return null;

    if (s.pendingAction === null) {
      return { type: "ADVANCE_CPU" };
    }

    if (s.pendingAction.type === "human_discard") {
      // Auto-drive the "human" seat (E) with its CPU strategy
      const hand = s.hands[OBSERVER_SEAT];
      if (!hand?.length) return null;
      const strategy = strategiesRef.current[OBSERVER_SEAT] ?? DIFFICULTY_PRESETS.intermediate;
      const evalResult = evaluateHand(hand, s.wall, PATTERNS);
      const choice = strategy.chooseDiscard(hand, evalResult, s.wall, PATTERNS);
      return { type: "HUMAN_DISCARD", tileId: choice.id };
    }

    if (s.pendingAction.type === "claim_window") {
      // Human seat passes — CPU claims are resolved in the engine
      return { type: "HUMAN_PASS" };
    }

    return null;
  }, []);

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const currentSpeed = speedRef.current;
    const isPaused = pausedRef.current;

    if (isPaused || currentSpeed === "step") return;

    if (currentSpeed === "ludicrous") {
      if (stateRef.current.phase === "setup" || stateRef.current.phase === "finished") return;
      // Run the entire game step-by-step, firing onStep for each transition
      let s = stateRef.current;
      const ctx = getCtx();
      let maxTurns = 1000;
      while ((s.phase === "charleston" || s.phase === "playing") && maxTurns-- > 0) {
        let action: GameAction | null = null;
        if (s.phase === "charleston") {
          if (s.pendingAction?.type === "human_charleston_pass") {
            const hand = s.hands[OBSERVER_SEAT];
            const strategy = strategiesRef.current[OBSERVER_SEAT] ?? DIFFICULTY_PRESETS.intermediate;
            const tiles = chooseTilesForCharleston(strategy, hand, s.wall, PATTERNS);
            action = { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles.map(t => t.id) };
          } else if (s.pendingAction?.type === "human_charleston_stop") {
            action = { type: "BEGIN_SECOND_CHARLESTON" };
          } else if (s.pendingAction?.type === "human_courtesy_propose") {
            action = { type: "HUMAN_COURTESY_RESPOND", count: 0 };
          } else if (s.pendingAction?.type === "human_courtesy_select") {
            action = { type: "HUMAN_COURTESY_PASS", tileIds: [] };
          } else {
            break;
          }
        } else {
          if (s.pendingAction === null) {
            action = { type: "ADVANCE_CPU" };
          } else if (s.pendingAction.type === "human_discard") {
            const hand = s.hands[OBSERVER_SEAT];
            if (!hand?.length) break;
            const strategy = strategiesRef.current[OBSERVER_SEAT] ?? DIFFICULTY_PRESETS.intermediate;
            const evalResult = evaluateHand(hand, s.wall, PATTERNS);
            const choice = strategy.chooseDiscard(hand, evalResult, s.wall, PATTERNS);
            action = { type: "HUMAN_DISCARD", tileId: choice.id };
          } else if (s.pendingAction.type === "claim_window") {
            action = { type: "HUMAN_PASS" };
          } else {
            break;
          }
        }
        const next = gameReducer(s, action, ctx);
        onStepRef.current?.(s, next);
        s = next;
      }
      rawDispatch({ type: "SET_STATE", state: s });
      return;
    }

    const delayMs = SPEED_DELAY_MS[currentSpeed];
    timerRef.current = setTimeout(() => {
      const action = getNextAction();
      if (!action) return;
      const next = gameReducer(stateRef.current, action, getCtx());
      onStepRef.current?.(stateRef.current, next);
      dispatch(action);
    }, delayMs);
  }, [dispatch, getNextAction]);

  // Re-schedule whenever state changes
  useEffect(() => {
    scheduleNext();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [state, paused, speed, scheduleNext]);

  // ── Instant mode: run entire game synchronously ───────────────────────────
  const runInstant = useCallback(() => {
    let s = stateRef.current;
    const ctx = getCtx();
    let maxTurns = 800;

    while ((s.phase === "charleston" || s.phase === "playing") && maxTurns-- > 0) {
      if (s.phase === "charleston") {
        if (s.pendingAction?.type === "human_charleston_pass") {
          const hand = s.hands[OBSERVER_SEAT];
          const strategy = strategiesRef.current[OBSERVER_SEAT] ?? DIFFICULTY_PRESETS.intermediate;
          const tiles = chooseTilesForCharleston(strategy, hand, s.wall, PATTERNS);
          s = gameReducer(s, { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles.map(t => t.id) }, ctx);
        } else if (s.pendingAction?.type === "human_charleston_stop") {
          s = gameReducer(s, { type: "BEGIN_SECOND_CHARLESTON" }, ctx);
        } else if (s.pendingAction?.type === "human_courtesy_propose") {
          s = gameReducer(s, { type: "HUMAN_COURTESY_RESPOND", count: 0 }, ctx);
        } else if (s.pendingAction?.type === "human_courtesy_select") {
          s = gameReducer(s, { type: "HUMAN_COURTESY_PASS", tileIds: [] }, ctx);
        } else {
          break;
        }
      } else {
        if (s.pendingAction === null) {
          s = gameReducer(s, { type: "ADVANCE_CPU" }, ctx);
        } else if (s.pendingAction.type === "human_discard") {
          const hand = s.hands[OBSERVER_SEAT];
          if (!hand?.length) break;
          const strategy = strategiesRef.current[OBSERVER_SEAT] ?? DIFFICULTY_PRESETS.intermediate;
          const evalResult = evaluateHand(hand, s.wall, PATTERNS);
          const choice = strategy.chooseDiscard(hand, evalResult, s.wall, PATTERNS);
          s = gameReducer(s, { type: "HUMAN_DISCARD", tileId: choice.id }, ctx);
        } else if (s.pendingAction.type === "claim_window") {
          s = gameReducer(s, { type: "HUMAN_PASS" }, ctx);
        } else {
          break;
        }
      }
    }

    // Batch-update React state with final result
    rawDispatch({ type: "RESET" }); // triggers re-render with final state via below
    // Note: we can't directly set state from outside useReducer.
    // Instead, use the START_GAME action and replay. For now instant mode
    // just sets speed to fast and lets auto-advance finish naturally.
  }, [getCtx]);

  // ── Public controls ───────────────────────────────────────────────────────

  const startGame = useCallback(() => {
    dispatch({ type: "START_GAME", strategies: strategiesRef.current });
    setPaused(false);
  }, [dispatch]);

  const step = useCallback(() => {
    const action = getNextAction();
    if (action) dispatch(action);
  }, [dispatch, getNextAction]);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    dispatch({ type: "RESET" });
    setPaused(false);
  }, [dispatch]);

  const togglePause = useCallback(() => {
    setPaused(p => !p);
  }, []);

  const stats: ObserveStats | null = state.phase === "finished"
    ? {
        totalTurns: state.turnNumber,
        winner: state.winner,
        winningPattern: state.winningPattern?.name ?? null,
        wallRemaining: state.wall.length,
      }
    : null;

  return {
    state,
    speed,
    setSpeed,
    paused,
    togglePause,
    startGame,
    step,
    reset,
    stats,
  };
}
