import { describe, it, expect } from "vitest";
import {
  randomStrategy,
  greedyStrategy,
  createProbabilisticStrategy,
  DIFFICULTY_PRESETS,
  chooseTilesForCharleston,
} from "@/engine/cpu";
import { gameReducer, createGameState } from "@/engine/gameEngine";
import { generateWall, shuffleWall, tileId } from "@/engine/tiles";
import type { Tile, Suit, TileVal } from "@/engine/tiles";
import { evaluateHand } from "@/engine/evaluator";
import { PATTERNS } from "@/engine/patterns";

// =============================================================================
// Helpers
// =============================================================================

function makeTile(suit: Suit, val: TileVal, copyIndex = 1): Tile {
  return {
    id: tileId(suit, val, copyIndex),
    suit, val, copyIndex,
    state: "in_hand",
    owner: "E",
    history: [],
  };
}

function makeJoker(copy = 1): Tile {
  return makeTile("joker", "joker", copy);
}

function freshWall(): Tile[] {
  return shuffleWall(generateWall());
}

// A 14-tile hand tenpai for "222 4444 666 8888" (all dots, NMJL 2468 section).
// Missing one 2-dots; bams-7 is the obvious junk tile.
const nearCompleteHand: Tile[] = [
  makeTile("dots", 2, 1), makeTile("dots", 2, 2),            // 2 of the 3 needed dots-2
  makeTile("dots", 4, 1), makeTile("dots", 4, 2), makeTile("dots", 4, 3), makeTile("dots", 4, 4), // kong
  makeTile("dots", 6, 1), makeTile("dots", 6, 2), makeTile("dots", 6, 3),                          // pung
  makeTile("dots", 8, 1), makeTile("dots", 8, 2), makeTile("dots", 8, 3), makeTile("dots", 8, 4), // kong
  makeTile("bams", 7, 1), // junk tile — should be discarded
];

// Discarding bams-7 leaves 13 tiles at shanten 0 (tenpai for "222 4444 666 8888").
// This discard completes the hand by providing the missing 3rd dots-2.
const completingDiscard = makeTile("dots", 2, 3);

// =============================================================================
// randomStrategy
// =============================================================================

describe("randomStrategy", () => {
  it("returns a tile that is in the hand", () => {
    const wall = freshWall();
    const result = randomStrategy.chooseDiscard(nearCompleteHand, evaluateHand(nearCompleteHand, wall), wall);
    expect(nearCompleteHand.some(t => t.id === result.id)).toBe(true);
  });

  it("shouldClaim returns a boolean", () => {
    const wall = freshWall();
    const result = randomStrategy.shouldClaim(completingDiscard, nearCompleteHand, "pung", wall);
    expect(typeof result).toBe("boolean");
  });
});

// =============================================================================
// greedyStrategy
// =============================================================================

describe("greedyStrategy", () => {
  it("chooses the junk tile as the best discard for a near-complete hand", () => {
    const wall = freshWall();
    const evalResult = evaluateHand(nearCompleteHand, wall);
    const choice = greedyStrategy.chooseDiscard(nearCompleteHand, evalResult, wall, PATTERNS);
    expect(choice.suit).toBe("bams");
    expect(choice.val).toBe(7);
  });

  it("claims mahjong when the discard completes the hand", () => {
    // Hand: like_ones minus junk, tenpai for 1-dots
    const tenpaiHand = nearCompleteHand.filter(t => !(t.suit === "bams" && t.val === 7));
    const wall = freshWall();
    const result = greedyStrategy.shouldClaim(completingDiscard, tenpaiHand, "mahjong", wall, PATTERNS);
    expect(result).toBe(true);
  });

  it("does not claim mahjong when the discard does not complete the hand", () => {
    const tenpaiHand = nearCompleteHand.filter(t => !(t.suit === "bams" && t.val === 7));
    const junkDiscard = makeTile("dots", 9, 2);
    const wall = freshWall();
    const result = greedyStrategy.shouldClaim(junkDiscard, tenpaiHand, "mahjong", wall, PATTERNS);
    expect(result).toBe(false);
  });
});

// =============================================================================
// createProbabilisticStrategy
// =============================================================================

describe("createProbabilisticStrategy", () => {
  it("with epsilon=0 always follows the evaluator (like greedy)", () => {
    const strategy = createProbabilisticStrategy({ epsilon: 0, claimThreshold: 0.1 });
    const wall = freshWall();
    const evalResult = evaluateHand(nearCompleteHand, wall);
    const choice = strategy.chooseDiscard(nearCompleteHand, evalResult, wall, PATTERNS);
    // With no randomness, should pick the same junk tile as greedy
    expect(choice.suit).toBe("bams");
    expect(choice.val).toBe(7);
  });

  it("with epsilon=1 always picks randomly (may not match greedy)", () => {
    const strategy = createProbabilisticStrategy({ epsilon: 1, claimThreshold: 0.1 });
    const wall = freshWall();
    const evalResult = evaluateHand(nearCompleteHand, wall);
    // Over 20 trials, at least one should differ from the greedy choice
    let differentCount = 0;
    for (let i = 0; i < 20; i++) {
      const choice = strategy.chooseDiscard(nearCompleteHand, evalResult, wall, PATTERNS);
      if (!(choice.suit === "bams" && choice.val === 7)) differentCount++;
    }
    expect(differentCount).toBeGreaterThan(0);
  });

  it("always claims mahjong regardless of epsilon", () => {
    const strategy = createProbabilisticStrategy({ epsilon: 1, claimThreshold: 0.99 });
    const tenpaiHand = nearCompleteHand.filter(t => !(t.suit === "bams" && t.val === 7));
    const wall = freshWall();
    // Run multiple times — should always claim mahjong
    for (let i = 0; i < 10; i++) {
      const result = strategy.shouldClaim(completingDiscard, tenpaiHand, "mahjong", wall, PATTERNS);
      expect(result).toBe(true);
    }
  });

  it("high claimThreshold suppresses pung claims on weak hands", () => {
    const strategy = createProbabilisticStrategy({ epsilon: 0, claimThreshold: 0.99 });
    // A hand with no particular pattern alignment
    const weakHand = [
      makeTile("dots", 2, 1), makeTile("dots", 2, 2), // two 2-dots (eligible for pung)
      makeTile("bams", 5, 1), makeTile("bams", 7, 1),
      makeTile("cracks", 3, 1), makeTile("cracks", 8, 1),
      makeTile("wind", "E", 1), makeTile("wind", "S", 1),
      makeTile("dragon", "red", 1),
      makeTile("dots", 6, 1), makeTile("dots", 4, 1),
      makeTile("bams", 2, 1), makeTile("cracks", 7, 1),
    ];
    const discardOf2Dots = makeTile("dots", 2, 3);
    const wall = freshWall();
    const result = strategy.shouldClaim(discardOf2Dots, weakHand, "pung", wall, PATTERNS);
    // Win probability after pung on a scattered hand is < 0.99 → should not claim
    expect(result).toBe(false);
  });
});

// =============================================================================
// DIFFICULTY_PRESETS
// =============================================================================

describe("DIFFICULTY_PRESETS", () => {
  it("all three presets exist and have the right difficulty labels", () => {
    expect(DIFFICULTY_PRESETS.beginner.difficulty).toBe("beginner");
    expect(DIFFICULTY_PRESETS.intermediate.difficulty).toBe("intermediate");
    expect(DIFFICULTY_PRESETS.advanced.difficulty).toBe("advanced");
  });

  it("beginner has higher epsilon than advanced (more random)", () => {
    // Verify over many trials that beginner makes more random choices
    const wall = freshWall();
    const evalResult = evaluateHand(nearCompleteHand, wall);
    let beginnerDiff = 0;
    let advancedDiff = 0;
    const trials = 50;

    for (let i = 0; i < trials; i++) {
      const bChoice = DIFFICULTY_PRESETS.beginner.chooseDiscard(nearCompleteHand, evalResult, wall, PATTERNS);
      const aChoice = DIFFICULTY_PRESETS.advanced.chooseDiscard(nearCompleteHand, evalResult, wall, PATTERNS);
      if (!(bChoice.suit === "bams" && bChoice.val === 7)) beginnerDiff++;
      if (!(aChoice.suit === "bams" && aChoice.val === 7)) advancedDiff++;
    }
    // Beginner should deviate from optimal more often than advanced
    expect(beginnerDiff).toBeGreaterThan(advancedDiff);
  });
});

// =============================================================================
// Game engine — full game integration
// =============================================================================

describe("gameEngine — full game simulation", () => {
  it("can run a complete 4-CPU game to conclusion without throwing", () => {
    const ctx = {
      humanSeat: "E" as const,
      humanSeats: new Set(["E" as const]),
      strategies: {
        E: DIFFICULTY_PRESETS.intermediate,
        S: DIFFICULTY_PRESETS.intermediate,
        W: DIFFICULTY_PRESETS.intermediate,
        N: DIFFICULTY_PRESETS.intermediate,
      },
      patterns: PATTERNS,
    };

    let state = createGameState();
    state = gameReducer(state, { type: "START_GAME" }, ctx);

    let maxTurns = 500;
    while ((state.phase === "charleston" || state.phase === "playing") && maxTurns-- > 0) {
      if (state.phase === "charleston") {
        if (state.pendingAction?.type === "human_charleston_pass") {
          const hand = state.hands["E"];
          const tiles = chooseTilesForCharleston(DIFFICULTY_PRESETS.intermediate, hand, state.wall, PATTERNS);
          state = gameReducer(state, { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles.map(t => t.id), seat: "E" }, ctx);
        } else if (state.pendingAction?.type === "human_charleston_stop") {
          state = gameReducer(state, { type: "BEGIN_SECOND_CHARLESTON", seat: "E" }, ctx);
        } else if (state.pendingAction?.type === "human_courtesy_propose") {
          // Decline courtesy in this integration test
          state = gameReducer(state, { type: "HUMAN_COURTESY_RESPOND", count: 0 }, ctx);
        } else if (state.pendingAction?.type === "human_courtesy_select") {
          const { count } = state.pendingAction;
          const tiles = state.hands["E"].filter(t => t.suit !== "joker").slice(0, count);
          state = gameReducer(state, { type: "HUMAN_COURTESY_PASS", tileIds: tiles.map(t => t.id) }, ctx);
        } else {
          break;
        }
      } else {
        if (state.pendingAction === null) {
          // CPU turn
          state = gameReducer(state, { type: "ADVANCE_CPU" }, ctx);
        } else if (state.pendingAction.type === "human_discard") {
          // Drive East (human) with greedy strategy
          const hand = state.hands["E"];
          if (!hand?.length) break;
          const evalResult = evaluateHand(hand, state.wall, PATTERNS);
          const choice = DIFFICULTY_PRESETS.intermediate.chooseDiscard(hand, evalResult, state.wall, PATTERNS);
          state = gameReducer(state, { type: "HUMAN_DISCARD", tileId: choice.id }, ctx);
        } else if (state.pendingAction.type === "claim_window") {
          // Human always passes in this integration test
          state = gameReducer(state, { type: "HUMAN_PASS", seat: "E" }, ctx);
        } else {
          break;
        }
      }
    }

    expect(["finished"]).toContain(state.phase);
    expect(state.winner === null || ["E", "S", "W", "N"].includes(state.winner!)).toBe(true);
  });
});
