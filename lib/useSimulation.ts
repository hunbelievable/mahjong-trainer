"use client";

import { useReducer, useCallback, useEffect, useRef } from "react";
import {
  createGameState,
  gameReducer,
} from "@/engine/gameEngine";
import type { GameState, GameAction, EngineContext } from "@/engine/gameEngine";
import type { ClaimType } from "@/engine/cpu";
import { DIFFICULTY_PRESETS } from "@/engine/cpu";
import type { DifficultyLevel, SeatStrategies } from "@/engine/cpu";
import { PATTERNS } from "@/engine/patterns";
import type { PlayerId } from "@/engine/tiles";

export interface SimulationOptions {
  humanSeat?: PlayerId;
  /** Per-seat difficulty, e.g. { S: 'advanced', W: 'beginner', N: 'intermediate' } */
  cpuDifficulty?: Partial<Record<PlayerId, DifficultyLevel>>;
  /** Delay in ms between CPU actions (for visual pacing). Default 600. */
  cpuDelayMs?: number;
}

export function useSimulation(options: SimulationOptions = {}) {
  const {
    humanSeat = "E",
    cpuDifficulty = {},
    cpuDelayMs = 600,
  } = options;

  // Build strategy map — CPU seats only
  const strategiesRef = useRef<SeatStrategies>({});
  useEffect(() => {
    const s: SeatStrategies = {};
    for (const seat of ["E", "S", "W", "N"] as PlayerId[]) {
      if (seat === humanSeat) continue;
      const level = (cpuDifficulty[seat] ?? "intermediate") as DifficultyLevel;
      s[seat] = DIFFICULTY_PRESETS[level];
    }
    strategiesRef.current = s;
  }, [humanSeat, cpuDifficulty]);

  // The context object passed into every reducer call
  function getCtx(): EngineContext {
    return {
      humanSeat,
      humanSeats: new Set([humanSeat]),
      strategies: strategiesRef.current,
      patterns: PATTERNS,
    };
  }

  // Wrap the reducer so it receives ctx automatically
  const [state, rawDispatch] = useReducer(
    (s: GameState, a: GameAction) => gameReducer(s, a, getCtx()),
    undefined,
    createGameState
  );

  const dispatch = useCallback((action: GameAction) => rawDispatch(action), [rawDispatch]);

  // Auto-advance CPU turns with a delay so the UI can animate
  const cpuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current);

    if (
      state.phase === "playing" &&
      state.pendingAction === null &&
      state.currentSeat !== humanSeat
    ) {
      cpuTimerRef.current = setTimeout(() => {
        dispatch({ type: "ADVANCE_CPU" });
      }, cpuDelayMs);
    }

    return () => {
      if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current);
    };
  }, [state.phase, state.pendingAction, state.currentSeat, state.turnNumber, humanSeat, cpuDelayMs, dispatch]);

  // Charleston is handled synchronously — no auto-advance needed

  // ── Human action handlers ──────────────────────────────────────────────────

  const startGame = useCallback(() => {
    dispatch({ type: "START_GAME", humanSeat, strategies: strategiesRef.current });
  }, [dispatch, humanSeat]);

  const discard = useCallback((tileId: string) => {
    dispatch({ type: "HUMAN_DISCARD", tileId });
  }, [dispatch]);

  const claim = useCallback((claimType: ClaimType) => {
    dispatch({ type: "HUMAN_CLAIM", claimType, seat: humanSeat });
  }, [dispatch, humanSeat]);

  const pass = useCallback(() => {
    dispatch({ type: "HUMAN_PASS", seat: humanSeat });
  }, [dispatch, humanSeat]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, [dispatch]);

  const stageCharleston = useCallback((tileIds: string[]) => {
    dispatch({ type: "HUMAN_STAGE_CHARLESTON", tileIds, seat: humanSeat });
  }, [dispatch, humanSeat]);

  const stopCharleston = useCallback(() => {
    dispatch({ type: "STOP_CHARLESTON", seat: humanSeat });
  }, [dispatch, humanSeat]);

  const beginSecondCharleston = useCallback(() => {
    dispatch({ type: "BEGIN_SECOND_CHARLESTON", seat: humanSeat });
  }, [dispatch, humanSeat]);

  const respondCourtesy = useCallback((count: number) => {
    dispatch({ type: "HUMAN_COURTESY_RESPOND", count });
  }, [dispatch]);

  const passCourtesy = useCallback((tileIds: string[]) => {
    dispatch({ type: "HUMAN_COURTESY_PASS", tileIds });
  }, [dispatch]);

  const swapJoker = useCallback((args: {
    meldOwnerSeat: PlayerId;
    meldIndex: number;
    jokerTileId: string;
    handTileId: string;
  }) => {
    dispatch({ type: "HUMAN_JOKER_SWAP", ...args });
  }, [dispatch]);

  return {
    state,
    startGame,
    discard,
    claim,
    pass,
    reset,
    stageCharleston,
    stopCharleston,
    beginSecondCharleston,
    respondCourtesy,
    passCourtesy,
    swapJoker,
    humanSeat,
  };
}
