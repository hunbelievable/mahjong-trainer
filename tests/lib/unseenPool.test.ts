import { describe, it, expect } from "vitest";
import { buildUnseenPool, evaluateHandFromView } from "@/lib/unseenPool";
import { tileId } from "@/engine/tiles";
import type { Tile, Suit, TileVal, PlayerId } from "@/engine/tiles";
import type { PlayerView } from "@/lib/server/redact";
import type { Meld } from "@/engine/gameEngine";

function mk(suit: Suit, val: TileVal, copy = 1): Tile {
  return { id: tileId(suit, val, copy), suit, val, copyIndex: copy, state: "in_hand", owner: "E", history: [] };
}

function baseView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    you: "E",
    phase: "playing",
    currentSeat: "E",
    yourHand: [],
    yourMelds: [],
    yourJokerSwaps: [],
    opponents: (["S", "W", "N"] as PlayerId[]).map((seat) => ({ seat, handCount: 13, melds: [] })),
    discardPile: { E: [], S: [], W: [], N: [] },
    wallCount: 80,
    lastDiscard: null,
    lastDrawSeat: null,
    yourFreshTileId: null,
    pendingActionForYou: null,
    charlestonWaitingOn: [],
    claimPendingCount: 0,
    turnNumber: 5,
    winner: null,
    winningPattern: null,
    log: [],
    match: null,
    ...overrides,
  };
}

describe("buildUnseenPool", () => {
  it("counts every copy of an untouched tile type as fully unseen (4 for suited)", () => {
    const view = baseView();
    const pool = buildUnseenPool(view);
    const dots1 = pool.filter((t) => t.suit === "dots" && t.val === 1);
    expect(dots1).toHaveLength(4);
  });

  it("counts flowers/jokers as fully unseen out of 8", () => {
    const pool = buildUnseenPool(baseView());
    expect(pool.filter((t) => t.suit === "flower")).toHaveLength(8);
    expect(pool.filter((t) => t.suit === "joker")).toHaveLength(8);
  });

  it("subtracts tiles in your own hand", () => {
    const view = baseView({ yourHand: [mk("dots", 1, 1), mk("dots", 1, 2)] });
    const pool = buildUnseenPool(view);
    expect(pool.filter((t) => t.suit === "dots" && t.val === 1)).toHaveLength(2);
  });

  it("subtracts tiles in exposed melds — yours and opponents'", () => {
    const yourMeld: Meld = { type: "pung", tiles: [mk("bams", 5, 1), mk("bams", 5, 2), mk("bams", 5, 3)], claimedFrom: "S" };
    const oppMeld: Meld = { type: "pung", tiles: [mk("cracks", 9, 1), mk("cracks", 9, 2), mk("cracks", 9, 3)], claimedFrom: "E" };
    const view = baseView({
      yourMelds: [yourMeld],
      opponents: [
        { seat: "S", handCount: 10, melds: [oppMeld] },
        { seat: "W", handCount: 13, melds: [] },
        { seat: "N", handCount: 13, melds: [] },
      ],
    });
    const pool = buildUnseenPool(view);
    expect(pool.filter((t) => t.suit === "bams" && t.val === 5)).toHaveLength(1);
    expect(pool.filter((t) => t.suit === "cracks" && t.val === 9)).toHaveLength(1);
  });

  it("subtracts discarded tiles across every seat", () => {
    const view = baseView({
      discardPile: { E: [mk("wind", "E", 1)], S: [mk("wind", "E", 2)], W: [], N: [] },
    });
    const pool = buildUnseenPool(view);
    expect(pool.filter((t) => t.suit === "wind" && t.val === "E")).toHaveLength(2);
  });

  it("never goes negative when a tile type is fully accounted for", () => {
    const view = baseView({
      yourHand: [mk("dragon", "red", 1), mk("dragon", "red", 2)],
      discardPile: { E: [], S: [mk("dragon", "red", 3)], W: [mk("dragon", "red", 4)], N: [] },
    });
    const pool = buildUnseenPool(view);
    expect(pool.filter((t) => t.suit === "dragon" && t.val === "red")).toHaveLength(0);
  });
});

describe("evaluateHandFromView", () => {
  it("uses the REAL public wallCount for winProbability/liveWallSize, not the synthetic pool size", () => {
    const view = baseView({
      yourHand: [
        mk("dots", 1, 1), mk("dots", 1, 2), mk("dots", 1, 3),
        mk("bams", 1, 1), mk("bams", 1, 2), mk("bams", 1, 3), mk("bams", 1, 4),
        mk("cracks", 1, 1), mk("cracks", 1, 2), mk("cracks", 1, 3), mk("cracks", 1, 4),
        mk("wind", "E", 1), mk("wind", "E", 2),
      ],
      wallCount: 42,
    });
    const result = evaluateHandFromView(view);
    // The synthetic unseen pool is much larger than 42 (it includes tiles
    // presumed to be in opponents' concealed hands too) — liveWallSize must
    // reflect the real, public count, not the pool's own length.
    expect(result.liveWallSize).toBe(42);
  });

  it("still detects a complete hand (shanten -1) regardless of the synthetic wall", () => {
    const view = baseView({
      yourHand: [
        mk("dots", 1, 1), mk("dots", 1, 2), mk("dots", 1, 3), mk("dots", 1, 4),
        mk("bams", 1, 1), mk("bams", 1, 2), mk("bams", 1, 3), mk("bams", 1, 4),
        mk("cracks", 1, 1), mk("cracks", 1, 2), mk("cracks", 1, 3), mk("cracks", 1, 4),
        mk("wind", "E", 1), mk("wind", "E", 2),
      ],
    });
    const result = evaluateHandFromView(view, [
      {
        id: "like_ones",
        name: "Like Ones",
        section: "test",
        difficulty: "hard",
        value: 25,
        description: "",
        suitMode: "none",
        valMode: { kind: "fixed" },
        groups: [
          { suit: "dots", val: 1, count: 4 },
          { suit: "bams", val: 1, count: 4 },
          { suit: "cracks", val: 1, count: 4 },
          { suit: "wind", val: "E", count: 2, jokerLocked: true },
        ],
      },
    ]);
    expect(result.shanten).toBe(-1);
    expect(result.winProbability).toBe(1);
  });
});
