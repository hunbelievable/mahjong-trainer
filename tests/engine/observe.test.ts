import { describe, it, expect } from "vitest";
import { gameReducer, createGameState } from "@/engine/gameEngine";
import type { GameState, EngineContext } from "@/engine/gameEngine";
import { DIFFICULTY_PRESETS } from "@/engine/cpu";
import { evaluateHand } from "@/engine/evaluator";
import { PATTERNS } from "@/engine/patterns";

// =============================================================================
// Helpers — drives all 4 seats as CPU (no human involvement)
// =============================================================================

function runFullGame(ctx: EngineContext): GameState {
  let state = createGameState();
  state = gameReducer(state, { type: "START_GAME" }, ctx);

  let maxTurns = 800;
  while (state.phase === "playing" && maxTurns-- > 0) {
    if (state.pendingAction === null) {
      state = gameReducer(state, { type: "ADVANCE_CPU" }, ctx);
    } else if (state.pendingAction.type === "human_discard") {
      const hand = state.hands[ctx.humanSeat];
      if (!hand?.length) break;
      const strategy = ctx.strategies[ctx.humanSeat] ?? DIFFICULTY_PRESETS.intermediate;
      const evalResult = evaluateHand(hand, state.wall, PATTERNS);
      const choice = strategy.chooseDiscard(hand, evalResult, state.wall, PATTERNS);
      state = gameReducer(state, { type: "HUMAN_DISCARD", tileId: choice.id }, ctx);
    } else if (state.pendingAction.type === "claim_window") {
      state = gameReducer(state, { type: "HUMAN_PASS" }, ctx);
    } else {
      break;
    }
  }
  return state;
}

const baseCtx: EngineContext = {
  humanSeat: "E",
  strategies: {
    E: DIFFICULTY_PRESETS.intermediate,
    S: DIFFICULTY_PRESETS.intermediate,
    W: DIFFICULTY_PRESETS.intermediate,
    N: DIFFICULTY_PRESETS.intermediate,
  },
  patterns: PATTERNS,
};

// =============================================================================
// Full game completion
// =============================================================================

describe("Observe mode — full game runs", () => {
  it("always finishes (winner or wall exhausted) within 800 turns", () => {
    const state = runFullGame(baseCtx);
    expect(state.phase).toBe("finished");
  });

  it("winner is a valid seat or null (wall exhausted)", () => {
    const state = runFullGame(baseCtx);
    expect(
      state.winner === null || ["E", "S", "W", "N"].includes(state.winner!)
    ).toBe(true);
  });

  it("if there is a winner, winningPattern is set", () => {
    // Run a few games — at least one should have a winner
    let foundWinner = false;
    for (let i = 0; i < 5; i++) {
      const state = runFullGame(baseCtx);
      if (state.winner) {
        expect(state.winningPattern).not.toBeNull();
        foundWinner = true;
        break;
      }
    }
    // Not asserting foundWinner — wall exhaustion is valid, just verifying the field
  });

  it("all players end with no more than 14 tiles", () => {
    const state = runFullGame(baseCtx);
    for (const seat of ["E", "S", "W", "N"] as const) {
      expect(state.hands[seat].length).toBeLessThanOrEqual(14);
    }
  });

  it("turn number is positive after a full game", () => {
    const state = runFullGame(baseCtx);
    expect(state.turnNumber).toBeGreaterThan(0);
  });

  it("game log is non-empty", () => {
    const state = runFullGame(baseCtx);
    expect(state.log.length).toBeGreaterThan(0);
  });

  it("wall has fewer tiles at end than at start", () => {
    const state = runFullGame(baseCtx);
    expect(state.wall.length).toBeLessThan(100);
  });
});

// =============================================================================
// Difficulty mix — different strategies produce different outcomes
// =============================================================================

describe("Observe mode — strategy mix", () => {
  it("runs cleanly with mixed difficulties", () => {
    const mixedCtx: EngineContext = {
      humanSeat: "E",
      strategies: {
        E: DIFFICULTY_PRESETS.advanced,
        S: DIFFICULTY_PRESETS.beginner,
        W: DIFFICULTY_PRESETS.advanced,
        N: DIFFICULTY_PRESETS.beginner,
      },
      patterns: PATTERNS,
    };
    const state = runFullGame(mixedCtx);
    expect(state.phase).toBe("finished");
  });

  it("runs cleanly with all beginners", () => {
    const ctx: EngineContext = {
      humanSeat: "E",
      strategies: {
        E: DIFFICULTY_PRESETS.beginner,
        S: DIFFICULTY_PRESETS.beginner,
        W: DIFFICULTY_PRESETS.beginner,
        N: DIFFICULTY_PRESETS.beginner,
      },
      patterns: PATTERNS,
    };
    const state = runFullGame(ctx);
    expect(state.phase).toBe("finished");
  });

  it("runs cleanly with all advanced", () => {
    const ctx: EngineContext = {
      humanSeat: "E",
      strategies: {
        E: DIFFICULTY_PRESETS.advanced,
        S: DIFFICULTY_PRESETS.advanced,
        W: DIFFICULTY_PRESETS.advanced,
        N: DIFFICULTY_PRESETS.advanced,
      },
      patterns: PATTERNS,
    };
    const state = runFullGame(ctx);
    expect(state.phase).toBe("finished");
  });
});

// =============================================================================
// Multiple games — no crashes across repeated runs
// =============================================================================

describe("Observe mode — stability", () => {
  it("10 consecutive games all finish cleanly", () => {
    for (let i = 0; i < 10; i++) {
      const state = runFullGame(baseCtx);
      expect(state.phase).toBe("finished");
    }
  });
});
