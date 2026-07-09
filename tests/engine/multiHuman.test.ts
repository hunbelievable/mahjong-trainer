import { describe, it, expect } from "vitest";
import { gameReducer, createGameState } from "@/engine/gameEngine";
import type { GameState, EngineContext, Meld } from "@/engine/gameEngine";
import { DIFFICULTY_PRESETS } from "@/engine/cpu";
import { PATTERNS } from "@/engine/patterns";
import { tileId } from "@/engine/tiles";
import type { Tile, Suit, TileVal, PlayerId } from "@/engine/tiles";

function mk(suit: Suit, val: TileVal, copy = 1, owner: PlayerId | null = null): Tile {
  return { id: tileId(suit, val, copy), suit, val, copyIndex: copy, state: "in_hand", owner, history: [] };
}

function baseCtx(humanSeats: PlayerId[]): EngineContext {
  const strategies = {
    E: DIFFICULTY_PRESETS.intermediate,
    S: DIFFICULTY_PRESETS.intermediate,
    W: DIFFICULTY_PRESETS.intermediate,
    N: DIFFICULTY_PRESETS.intermediate,
  };
  // Mirrors GameRoom's own fallback: humanSeat defaults to "E" when no real human is left.
  return { humanSeat: humanSeats[0] ?? "E", humanSeats: new Set(humanSeats), strategies, patterns: PATTERNS };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createGameState(),
    phase: "playing",
    wall: [mk("dots", 5, 1), mk("bams", 5, 1)],
    hands: { E: [], S: [], W: [], N: [] },
    melds: { E: [], S: [], W: [], N: [] },
    discardPile: { E: [], S: [], W: [], N: [] },
    currentSeat: "E",
    turnNumber: 5,
    ...overrides,
  };
}

describe("multi-human claim windows — priority + tie-break", () => {
  it("a kong claim beats a pung claim regardless of seat order", () => {
    const discard = mk("dots", 7, 4, "E");
    // S can only pung (2 matching); N can kong (3 matching) — N should win despite being farther from the discarder.
    const state = baseState({
      hands: {
        E: [],
        S: [mk("dots", 7, 1), mk("dots", 7, 2)],
        W: [],
        N: [mk("dots", 7, 1), mk("dots", 7, 2), mk("dots", 7, 3)],
      },
      pendingAction: {
        type: "claim_window",
        discard,
        discardedBy: "E",
        eligibleSeats: { S: ["pung"], N: ["kong", "pung"] },
        responses: {},
      },
    });
    const ctx = baseCtx(["S", "N"]);

    let next = gameReducer(state, { type: "HUMAN_CLAIM", claimType: "pung", seat: "S" }, ctx);
    expect(next.melds.S).toHaveLength(0); // still waiting on N — S's claim alone doesn't resolve it
    next = gameReducer(next, { type: "HUMAN_CLAIM", claimType: "kong", seat: "N" }, ctx);

    expect(next.melds.N).toHaveLength(1);
    expect(next.melds.N[0].type).toBe("kong");
    expect(next.melds.S).toHaveLength(0); // S's pung lost to N's kong
  });

  it("ties broken by nearest seat in turn order from the discarder", () => {
    const discard = mk("bams", 3, 4, "E");
    // Both S and N offer an equal-rank pung. S is closer to E in turn order (E→S→W→N) and should win.
    const state = baseState({
      hands: {
        E: [],
        S: [mk("bams", 3, 1), mk("bams", 3, 2)],
        W: [],
        N: [mk("bams", 3, 1), mk("bams", 3, 2)],
      },
      pendingAction: {
        type: "claim_window",
        discard,
        discardedBy: "E",
        eligibleSeats: { S: ["pung"], N: ["pung"] },
        responses: {},
      },
    });
    const ctx = baseCtx(["S", "N"]);

    let next = gameReducer(state, { type: "HUMAN_CLAIM", claimType: "pung", seat: "N" }, ctx);
    expect(next.melds.N).toHaveLength(0); // still waiting on S
    next = gameReducer(next, { type: "HUMAN_CLAIM", claimType: "pung", seat: "S" }, ctx);

    expect(next.melds.S).toHaveLength(1);
    expect(next.melds.N).toHaveLength(0);
  });

  it("advances play when every eligible seat passes", () => {
    const discard = mk("cracks", 2, 4, "E");
    const state = baseState({
      hands: { E: [], S: [mk("cracks", 2, 1), mk("cracks", 2, 2)], W: [], N: [mk("cracks", 2, 1)] },
      pendingAction: {
        type: "claim_window",
        discard,
        discardedBy: "E",
        eligibleSeats: { S: ["pung"] },
        responses: {},
      },
    });
    const ctx = baseCtx(["S"]);
    const next = gameReducer(state, { type: "HUMAN_PASS", seat: "S" }, ctx);
    expect(next.pendingAction?.type).not.toBe("claim_window");
    expect(next.melds.S).toHaveLength(0);
  });

  it("a mahjong claim resolves immediately without waiting for other eligible seats", () => {
    // A single-tile "pair-only" pattern would be needed for a real winning hand;
    // instead we assert the short-circuit behavior directly: once eligibleSeats
    // includes "mahjong" for a seat and HUMAN_CLAIM names it, the game finishes
    // in one step regardless of any other seat's outstanding eligibility.
    const discard = mk("dragon", "red", 4, "E");
    const state = baseState({
      hands: {
        E: [],
        // A real winning hand for the evaluator isn't needed for this assertion —
        // applyMahjongWin unconditionally finishes the game once HUMAN_CLAIM
        // names "mahjong" for an eligible seat; that eligibility gate is what
        // this test exercises, not pattern matching (covered in evaluator.test.ts).
        S: [mk("dragon", "red", 1), mk("dragon", "red", 2)],
        W: [],
        N: [mk("dots", 1, 1)],
      },
      pendingAction: {
        type: "claim_window",
        discard,
        discardedBy: "E",
        eligibleSeats: { S: ["mahjong", "pung"], N: ["pung"] },
        responses: {},
      },
    });
    const ctx = baseCtx(["S", "N"]);
    const next = gameReducer(state, { type: "HUMAN_CLAIM", claimType: "mahjong", seat: "S" }, ctx);

    expect(next.phase).toBe("finished");
    expect(next.winner).toBe("S");
    expect(next.winKind).toBe("discard");
    expect(next.winDiscardedBy).toBe("E");
  });
});

describe("HUMAN_JOKER_SWAP addresses the seat whose turn it actually is", () => {
  it("validates against state.currentSeat, not the first human in ctx.humanSeats", () => {
    const jokerMeld: Meld = {
      type: "pung",
      tiles: [mk("bams", 9, 1, "W"), mk("bams", 9, 2, "W"), mk("joker", "joker", 1, "W")],
      claimedFrom: "E",
    };
    const state = baseState({
      currentSeat: "S", // it's S's turn, not E's (the first human in ctx.humanSeats below)
      pendingAction: { type: "human_discard" },
      melds: { E: [], S: [], W: [jokerMeld], N: [] },
      hands: {
        E: [mk("bams", 9, 3, "E")], // E holds the matching natural — must NOT be used
        S: [mk("bams", 9, 4, "S")], // S holds the matching natural — the real actor
        W: [],
        N: [],
      },
    });
    const ctx = baseCtx(["E", "S"]); // ctx.humanSeat = "E" (first), but currentSeat is "S"

    const next = gameReducer(
      state,
      {
        type: "HUMAN_JOKER_SWAP",
        meldOwnerSeat: "W",
        meldIndex: 0,
        jokerTileId: tileId("joker", "joker", 1),
        handTileId: tileId("bams", 9, 4), // S's tile
      },
      ctx,
    );

    // The swap succeeded using S's hand — proves state.currentSeat was used, not ctx.humanSeat ("E").
    expect(next.hands.S.find((t) => t.suit === "joker")).toBeDefined();
    expect(next.hands.E).toHaveLength(1); // E's hand untouched
    expect(next.melds.W[0].tiles.some((t) => t.id === tileId("bams", 9, 4))).toBe(true);
  });

  it("rejects the swap if E's (not the acting seat's) hand happens to hold the matching tile", () => {
    const jokerMeld: Meld = {
      type: "pung",
      tiles: [mk("bams", 9, 1, "W"), mk("bams", 9, 2, "W"), mk("joker", "joker", 1, "W")],
      claimedFrom: "E",
    };
    const state = baseState({
      currentSeat: "S",
      pendingAction: { type: "human_discard" },
      melds: { E: [], S: [], W: [jokerMeld], N: [] },
      hands: {
        E: [mk("bams", 9, 3, "E")], // only E holds the matching natural
        S: [mk("dots", 1, 1, "S")], // S does NOT hold it
        W: [],
        N: [],
      },
    });
    const ctx = baseCtx(["E", "S"]);

    const next = gameReducer(
      state,
      {
        type: "HUMAN_JOKER_SWAP",
        meldOwnerSeat: "W",
        meldIndex: 0,
        jokerTileId: tileId("joker", "joker", 1),
        handTileId: tileId("bams", 9, 3), // E's tile — not in S's (the actor's) hand
      },
      ctx,
    );

    expect(next).toBe(state); // rejected — no mutation
  });
});

describe("CONVERT_TO_CPU — resolving whatever a kicked/forfeited seat still owed", () => {
  // In every case here, `seat` has ALREADY been removed from ctx.humanSeats —
  // that's GameRoom.convertSeatToCpu's job, done before dispatching this
  // action (see lib/server/gameRoom.ts). The reducer's only job is cleaning
  // up state that assumed a human was still there.

  it("mid-discard-turn: clears pendingAction so ADVANCE_CPU can take over", () => {
    const state = baseState({
      phase: "playing",
      currentSeat: "S",
      pendingAction: { type: "human_discard" },
      hands: { E: [], S: [mk("dots", 1, 1)], W: [], N: [] },
    });
    const ctx = baseCtx(["E"]); // S already removed
    const next = gameReducer(state, { type: "CONVERT_TO_CPU", seat: "S" }, ctx);
    expect(next.pendingAction).toBeNull();
  });

  it("mid-Charleston-stage: synthesizes a pick for the converted seat and waits if another human still hasn't staged", () => {
    const state = baseState({
      phase: "charleston",
      pendingAction: { type: "human_charleston_pass", step: 0 },
      charleston: { step: 0, staged: { E: ["x", "y", "z"] }, lastReceived: {} },
      hands: {
        E: [],
        S: [mk("dots", 1, 1), mk("dots", 2, 1), mk("dots", 3, 1)],
        W: [],
        N: [mk("dots", 4, 1), mk("dots", 5, 1), mk("dots", 6, 1)],
      },
    });
    const ctx = baseCtx(["N"]); // E already staged (CPU), S just converted, N still a real human
    const next = gameReducer(state, { type: "CONVERT_TO_CPU", seat: "S" }, ctx);

    expect(next.charleston?.staged.S).toBeDefined();
    // N hasn't staged yet — the barrier doesn't advance, step stays 0.
    expect(next.pendingAction).toEqual({ type: "human_charleston_pass", step: 0 });
  });

  it("mid-Charleston-stage: converting the LAST needed seat executes the step", () => {
    const hand5 = (suit: Suit, copy = 1) => [1, 2, 3, 4, 5].map((v) => mk(suit, v as TileVal, copy)) as Tile[];
    const state = baseState({
      phase: "charleston",
      pendingAction: { type: "human_charleston_pass", step: 0 },
      charleston: {
        step: 0,
        staged: {
          E: hand5("dots").slice(0, 3).map((t) => t.id),
          N: hand5("cracks").slice(0, 3).map((t) => t.id),
        },
        lastReceived: {},
      },
      hands: { E: hand5("dots"), S: hand5("bams"), W: hand5("cracks", 2), N: hand5("cracks") },
    });
    // N is still a real human (already staged for step 0); S was the only OTHER
    // human left waiting — converting them should complete step 0's barrier and
    // pause again at step 1, still waiting on N (not cascade past them).
    const ctx = baseCtx(["N"]);
    const next = gameReducer(state, { type: "CONVERT_TO_CPU", seat: "S" }, ctx);

    expect(next.charleston?.step).toBe(1);
    expect(next.pendingAction).toEqual({ type: "human_charleston_pass", step: 1 });
  });

  it("mid-Charleston-vote: synthesizes a vote for the converted seat", () => {
    const state = baseState({
      phase: "charleston",
      pendingAction: { type: "human_charleston_stop", votes: { E: false, W: false, N: false } },
      charleston: { step: 3, staged: {}, lastReceived: {} },
      hands: { E: [], S: [mk("dots", 1, 1)], W: [], N: [] },
    });
    const ctx = baseCtx([]); // S already removed
    const next = gameReducer(state, { type: "CONVERT_TO_CPU", seat: "S" }, ctx);

    // A vote was recorded one way or the other — either resolved outright (if S's
    // synthesized vote was "stop") or is now waiting on nobody (all 4 accounted for).
    if (next.pendingAction?.type === "human_charleston_stop") {
      expect(next.pendingAction.votes.S).toBeDefined();
    } else {
      // Resolved (Second Charleston began or was skipped) — either is valid.
      expect(next.phase === "charleston").toBe(true);
    }
  });

  it("mid-claim-window: drops the converted seat's eligibility so resolution proceeds without them", () => {
    const discard = mk("dots", 7, 4, "E");
    const state = baseState({
      hands: { E: [], S: [], W: [], N: [mk("dots", 1, 1)] },
      pendingAction: {
        type: "claim_window",
        discard,
        discardedBy: "E",
        eligibleSeats: { S: ["pung"] },
        responses: {},
      },
    });
    const ctx = baseCtx([]); // S already removed — no human left to wait for
    const next = gameReducer(state, { type: "CONVERT_TO_CPU", seat: "S" }, ctx);

    // The window resolved (no candidates, since S wasn't actually holding a real
    // pung in this fixture and no CPU strategy would claim it either) — the
    // important thing is it's no longer stuck waiting on S specifically.
    expect(next.pendingAction?.type).not.toBe("claim_window");
  });

  it("is a no-op when nothing is currently pending for the converted seat", () => {
    const state = baseState({
      phase: "playing",
      currentSeat: "E",
      pendingAction: { type: "human_discard" },
      hands: { E: [mk("dots", 1, 1)], S: [], W: [], N: [] },
    });
    const ctx = baseCtx(["E"]);
    const next = gameReducer(state, { type: "CONVERT_TO_CPU", seat: "S" }, ctx);
    expect(next).toBe(state); // nothing to clean up for S right now
  });
});
