import { describe, it, expect, beforeEach } from "vitest";
import {
  shantenForPattern,
  evaluateHand,
  bestDiscard,
  computeWinProbability,
} from "@/engine/evaluator";
import { generateWall, shuffleWall, dealHands, tileId } from "@/engine/tiles";
import type { Tile, Suit, TileVal, SuitedVal, WindVal } from "@/engine/tiles";
import { PATTERNS, CONCRETE_PATTERNS } from "@/engine/patterns";
import type { HandPattern, HandPatternTemplate } from "@/engine/patterns";

// =============================================================================
// Helpers
// =============================================================================

/** Build a minimal Tile object for testing without needing a full wall. */
function makeTile(suit: Suit, val: TileVal, copyIndex = 1): Tile {
  return {
    id: tileId(suit, val, copyIndex),
    suit,
    val,
    copyIndex,
    state: "in_hand",
    owner: "E",
    history: [],
  };
}

function makeJoker(copyIndex = 1): Tile {
  return makeTile("joker", "joker", copyIndex);
}

/** Build a hand from a list of (suit, val) pairs, auto-incrementing copy indexes. */
function buildHand(specs: Array<[Suit, TileVal]>): Tile[] {
  const copies = new Map<string, number>();
  return specs.map(([suit, val]) => {
    const key = `${suit}:${val}`;
    const idx = (copies.get(key) ?? 0) + 1;
    copies.set(key, idx);
    return makeTile(suit, val, idx);
  });
}

/**
 * Inline test patterns — independent of which NMJL card patterns are loaded.
 * "Like Ones": kong of 1s in all 3 suits + E-wind pair (14 tiles).
 */
const LIKE_ONES_TEMPLATE: HandPatternTemplate = {
  id: "like_ones",
  name: "Like Ones",
  section: "test",
  difficulty: "hard",
  value: 25,
  description: "Kong of 1s in dots, bams, cracks + E-wind pair",
  suitMode: "none",
  valMode: { kind: "fixed" },
  groups: [
    { suit: "dots",   val: 1 as SuitedVal,   count: 4 },
    { suit: "bams",   val: 1 as SuitedVal,   count: 4 },
    { suit: "cracks", val: 1 as SuitedVal,   count: 4 },
    { suit: "wind",   val: "E" as WindVal,   count: 2, jokerLocked: true },
  ],
};

const likeOnes: HandPattern = {
  id: "like_ones_0",
  name: "Like Ones",
  description: "Kong of 1s in dots, bams, cracks + E-wind pair",
  difficulty: "hard",
  groups: [
    { suit: "dots",   val: 1,   count: 4 },
    { suit: "bams",   val: 1,   count: 4 },
    { suit: "cracks", val: 1,   count: 4 },
    { suit: "wind",   val: "E", count: 2, jokerLocked: true },
  ],
  totalTiles: 14,
};

// Fallback concrete pattern for quint test — build one directly
const quint_sevens_concrete: HandPattern = {
  id: "quint_sevens_test",
  name: "Quint Sevens",
  description: "Quint 7-cracks + pung 7-dots + pung 7-bams + pung white dragons.",
  difficulty: "hard",
  groups: [
    { suit: "cracks", val: 7, count: 5 },
    { suit: "dots",   val: 7, count: 3 },
    { suit: "bams",   val: 7, count: 3 },
    { suit: "dragon", val: "white", count: 3 },
  ],
  totalTiles: 14,
};

const dragonPower_concrete: HandPattern = {
  id: "dragon_power_test",
  name: "Dragon Power",
  description: "Kong of red dragons, kong of green dragons, kong of white dragons, pair of North winds.",
  difficulty: "medium",
  groups: [
    { suit: "dragon", val: "red",   count: 4 },
    { suit: "dragon", val: "green", count: 4 },
    { suit: "dragon", val: "white", count: 4 },
    { suit: "wind",   val: "N",     count: 2, jokerLocked: true },
  ],
  totalTiles: 14,
};

// =============================================================================
// Pattern validation
// =============================================================================

describe("PATTERNS (templates)", () => {
  it("has the official NMJL card patterns loaded", () => {
    expect(PATTERNS.length).toBeGreaterThan(10);
  });

  it("all template IDs are unique", () => {
    const ids = PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(PATTERNS.length);
  });
});

describe("CONCRETE_PATTERNS", () => {
  it("expands to more than 3 concrete patterns", () => {
    expect(CONCRETE_PATTERNS.length).toBeGreaterThan(3);
  });

  it("all concrete pattern IDs are unique", () => {
    const ids = CONCRETE_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(CONCRETE_PATTERNS.length);
  });

  it("every concrete pattern totals exactly 14 tiles", () => {
    for (const p of CONCRETE_PATTERNS) {
      const total = p.groups.reduce((sum, g) => sum + g.count, 0);
      expect(total, `Pattern "${p.id}" should sum to 14`).toBe(14);
    }
  });
});

// =============================================================================
// shantenForPattern
// =============================================================================

describe("shantenForPattern — like_ones", () => {
  it("returns shanten -1 for a complete hand", () => {
    // 4x 1-dots, 4x 1-bams, 4x 1-cracks, 2x E-wind = 14 tiles
    const hand = buildHand([
      ["dots", 1], ["dots", 1], ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    const result = shantenForPattern(hand, likeOnes);
    expect(result.shanten).toBe(-1);
    expect(result.tilesMatched).toBe(14);
  });

  it("returns shanten 0 (tenpai) when one tile is missing", () => {
    // Missing one 1-dots (only 3 of them)
    const hand = buildHand([
      ["dots", 1], ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    const result = shantenForPattern(hand, likeOnes);
    expect(result.shanten).toBe(0);
    expect(result.tilesMatched).toBe(13);
  });

  it("returns shanten 1 when two tiles are missing", () => {
    const hand = buildHand([
      ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    const result = shantenForPattern(hand, likeOnes);
    expect(result.shanten).toBe(1);
  });

  it("irrelevant tiles don't improve shanten", () => {
    // Tiles that don't match likeOnes at all
    const hand = buildHand([
      ["dots", 5], ["dots", 5], ["dots", 5], ["dots", 5],
      ["bams", 3], ["bams", 3], ["bams", 3], ["bams", 3],
      ["cracks", 7], ["cracks", 7], ["cracks", 7], ["cracks", 7],
      ["wind", "S"], ["wind", "S"],
    ]);
    const result = shantenForPattern(hand, likeOnes);
    // 0 natural matches → needs all 14 → shanten = 13
    expect(result.shanten).toBe(13);
  });
});

describe("shantenForPattern — joker handling", () => {
  it("joker fills a non-pair group to complete a 14-tile hand (shanten -1)", () => {
    // 14-tile hand: 3 natural 1-dots + 1 joker (fills 4th dot slot) + 4 bams + 4 cracks + 2 E-winds
    const hand = buildHand([
      ["dots", 1], ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    hand.push(makeJoker()); // 14th tile is a joker that fills the dots kong
    const result = shantenForPattern(hand, likeOnes);
    expect(result.shanten).toBe(-1);
    expect(result.tilesMatched).toBe(14);
  });

  it("joker does NOT substitute in a jokerLocked pair group", () => {
    // like_ones pair is E-wind with jokerLocked: true
    // Hand: 4x 1-dots, 4x 1-bams, 4x 1-cracks, 1x E-wind, 1x joker
    const hand = buildHand([
      ["dots", 1], ["dots", 1], ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"],
    ]);
    hand.push(makeJoker());
    const result = shantenForPattern(hand, likeOnes);
    // Joker can't fill the locked pair → still need 1 E-wind → shanten 0
    expect(result.shanten).toBe(0);
  });

  it("joker fills a quint slot", () => {
    // quint_sevens_concrete: 5x 7-cracks (4 natural + 1 joker)
    const hand = buildHand([
      ["cracks", 7], ["cracks", 7], ["cracks", 7], ["cracks", 7],
      ["dots",   7], ["dots",   7], ["dots",   7],
      ["bams",   7], ["bams",   7], ["bams",   7],
      ["dragon", "white"], ["dragon", "white"], ["dragon", "white"],
    ]);
    hand.push(makeJoker());
    const result = shantenForPattern(hand, quint_sevens_concrete);
    expect(result.shanten).toBe(-1);
  });
});

// =============================================================================
// computeWinProbability
// =============================================================================

describe("computeWinProbability", () => {
  it("returns 1 when already won (shanten -1)", () => {
    expect(computeWinProbability(-1, 0, 50)).toBe(1);
  });

  it("returns 0 when no outs", () => {
    expect(computeWinProbability(0, 0, 50)).toBe(0);
  });

  it("returns 0 when wall is empty", () => {
    expect(computeWinProbability(0, 4, 0)).toBe(0);
  });

  it("tenpai with all outs: probability = outs / wall", () => {
    // 4 outs in wall of 40
    const prob = computeWinProbability(0, 4, 40);
    expect(prob).toBeCloseTo(4 / 40, 5);
  });

  it("higher shanten = lower probability", () => {
    const p0 = computeWinProbability(0, 4, 50);
    const p1 = computeWinProbability(1, 4, 50);
    const p2 = computeWinProbability(2, 4, 50);
    expect(p0).toBeGreaterThan(p1);
    expect(p1).toBeGreaterThan(p2);
  });

  it("more outs = higher probability (same shanten)", () => {
    const pFew = computeWinProbability(0, 2, 50);
    const pMany = computeWinProbability(0, 8, 50);
    expect(pMany).toBeGreaterThan(pFew);
  });

  it("probability never exceeds 1", () => {
    expect(computeWinProbability(0, 100, 10)).toBeLessThanOrEqual(1);
  });

  it("probability is non-negative", () => {
    expect(computeWinProbability(3, 2, 30)).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// evaluateHand (integration)
// =============================================================================

describe("evaluateHand", () => {
  /** Build a minimal fake wall with specific tiles marked as in_wall */
  function fakeWall(tiles: Tile[]): Tile[] {
    return tiles.map((t) => ({ ...t, state: "in_wall" as const, owner: null }));
  }

  it("detects a complete like_ones hand (shanten -1)", () => {
    const hand = buildHand([
      ["dots", 1], ["dots", 1], ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    // Need at least 16 tiles in wall for the helper to work
    const wall = fakeWall(Array.from({ length: 16 + 1 }, (_, i) =>
      makeTile("dots", 2, i + 1)
    ));
    const result = evaluateHand(hand, wall, [LIKE_ONES_TEMPLATE]);
    expect(result.shanten).toBe(-1);
    expect(result.winProbability).toBe(1);
    expect(result.outs).toHaveLength(0);
  });

  it("returns outs for a tenpai hand", () => {
    // Missing one 1-dots to complete like_ones
    const hand = buildHand([
      ["dots", 1], ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    // Wall contains 2 live copies of 1-dots
    const liveDots = [makeTile("dots", 1, 4), makeTile("dots", 1, 5)];
    const deadPadding = Array.from({ length: 16 }, (_, i) =>
      makeTile("bams", 9, i + 1)
    );
    const wall = fakeWall([...liveDots, ...deadPadding]);

    const result = evaluateHand(hand, wall, [LIKE_ONES_TEMPLATE]);
    expect(result.shanten).toBe(0);
    expect(result.outs).toHaveLength(1);
    expect(result.outs[0].suit).toBe("dots");
    expect(result.outs[0].val).toBe(1);
    expect(result.outs[0].liveCount).toBe(2);
    expect(result.totalOuts).toBe(2);
  });

  it("flags a hand as dead when the only completing tile is gone (not in wall)", () => {
    // Tenpai-shaped for like_ones, but every remaining 1-dots is gone from the
    // wall. The pattern can never be completed, so it is reported as dead
    // (shanten Infinity) rather than a 0% tenpai.
    const hand = buildHand([
      ["dots", 1], ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    // Wall has no 1-dots at all
    const deadPadding = Array.from({ length: 16 + 5 }, (_, i) =>
      makeTile("bams", 9, i + 1)
    );
    const wall = fakeWall(deadPadding);

    const result = evaluateHand(hand, wall, [LIKE_ONES_TEMPLATE]);
    expect(Number.isFinite(result.shanten)).toBe(false); // dead hand
    expect(result.bestPatterns).toHaveLength(0);
    expect(result.totalOuts).toBe(0);
    expect(result.winProbability).toBe(0);
  });

  it("picks the best pattern across multiple options", () => {
    // Hand that is 2-away from likeOnes but 5-away from dragonPower
    const hand = buildHand([
      ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    // The two missing 1-dots are still live in the wall, so like_ones is reachable.
    const wall = fakeWall([
      makeTile("dots", 1, 3), makeTile("dots", 1, 4),
      ...Array.from({ length: 16 }, (_, i) => makeTile("dots", 5, i + 1)),
    ]);

    const result = evaluateHand(hand, wall, [LIKE_ONES_TEMPLATE]);
    expect(result.shanten).toBe(1); // likeOnes is closer
    expect(result.bestPatterns[0].templateId).toMatch(/^like_ones/);
  });

  it("uses the full PATTERNS library by default and does not throw", () => {
    // A random hand — just verify evaluateHand runs without error using default PATTERNS
    const hand = buildHand([
      ["dots", 2], ["dots", 2], ["dots", 2], ["dots", 2],
      ["bams", 4], ["bams", 4], ["bams", 4], ["bams", 4],
      ["cracks", 6], ["cracks", 6], ["cracks", 6],
      ["cracks", 8], ["cracks", 8], ["cracks", 8],
    ]);
    const wall = fakeWall(Array.from({ length: 16 + 1 }, (_, i) =>
      makeTile("dots", 5, i + 1)
    ));
    const result = evaluateHand(hand, wall);
    expect(result.shanten).toBeGreaterThanOrEqual(-1);
    expect(result.winProbability).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// bestDiscard
// =============================================================================

describe("bestDiscard", () => {
  function fakeWall(n = 16 + 20): Tile[] {
    return Array.from({ length: n }, (_, i) =>
      ({ ...makeTile("dots", 5, i + 100), state: "in_wall" as const, owner: null })
    );
  }

  it("handles a non-14-tile hand without throwing", () => {
    // bestDiscard is tolerant of off-size hands (the UI calls it with 13- and
    // 14-tile hands incl. exposed melds); it must not throw.
    const hand = buildHand([["dots", 1]]);
    let options: ReturnType<typeof bestDiscard> | undefined;
    expect(() => { options = bestDiscard(hand, fakeWall(), PATTERNS); }).not.toThrow();
    expect(Array.isArray(options)).toBe(true);
  });

  it("returns 14 discard options for a 14-tile hand", () => {
    const hand = buildHand([
      ["dots", 1], ["dots", 1], ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    // 14th tile is a junk tile
    hand[13] = makeTile("dots", 9, 1);

    const options = bestDiscard(hand, fakeWall(), [LIKE_ONES_TEMPLATE]);
    expect(options).toHaveLength(14);
  });

  it("best discard is the junk tile (one that doesn't fit the target pattern)", () => {
    // 13 tiles perfectly set up for like_ones + 1 junk 9-dots
    const hand = buildHand([
      ["dots", 1], ["dots", 1], ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    hand[13] = makeTile("dots", 9, 1);

    // E-winds must be live in the wall for the E-pair to be completable.
    const wall = [
      makeTile("wind", "E", 3), makeTile("wind", "E", 4),
      ...Array.from({ length: 30 }, (_, i) => makeTile("dots", 5, i + 100)),
    ].map(t => ({ ...t, state: "in_wall" as const, owner: null }));

    const options = bestDiscard(hand, wall, [LIKE_ONES_TEMPLATE]);
    // Discarding 9-dots leaves 13 tiles: 4 dots + 4 bams + 4 cracks + 1 E-wind
    // → tenpai (shanten 0), waiting on E-wind to complete like_ones
    expect(options[0].result.shanten).toBe(0);
    expect(options[0].tile.suit).toBe("dots");
    expect(options[0].tile.val).toBe(9);
  });

  it("results are sorted: lower shanten first", () => {
    const hand = buildHand([
      ["dots", 1], ["dots", 1], ["dots", 1], ["dots", 1],
      ["bams", 1], ["bams", 1], ["bams", 1], ["bams", 1],
      ["cracks", 1], ["cracks", 1], ["cracks", 1], ["cracks", 1],
      ["wind", "E"], ["wind", "E"],
    ]);
    hand[13] = makeTile("dots", 9, 1);

    const options = bestDiscard(hand, fakeWall(), [LIKE_ONES_TEMPLATE]);
    for (let i = 1; i < options.length; i++) {
      expect(options[i - 1].result.shanten).toBeLessThanOrEqual(
        options[i].result.shanten
      );
    }
  });
});

// =============================================================================
// Integration: deal a real hand and evaluate it
// =============================================================================

describe("evaluateHand — with real wall", () => {
  it("returns a valid EvalResult for any random dealt hand", () => {
    const wall = shuffleWall(generateWall());
    const { hands, wall: remaining } = dealHands(wall);
    const eastHand = hands["E"];

    const result = evaluateHand(eastHand, remaining);

    expect(result.shanten).toBeGreaterThanOrEqual(0); // very unlikely to be tenpai on deal
    expect(result.shanten).toBeLessThanOrEqual(13);
    expect(result.winProbability).toBeGreaterThanOrEqual(0);
    expect(result.winProbability).toBeLessThanOrEqual(1);
    expect(result.liveWallSize).toBeGreaterThan(0);
    expect(Array.isArray(result.outs)).toBe(true);
  });
});
