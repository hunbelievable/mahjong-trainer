import { describe, it, expect } from "vitest";
import {
  generateWall,
  shuffleWall,
  dealHands,
  tileId,
  SEAT_ORDER,
  type Tile,
  type Suit,
  type PlayerId,
} from "@/engine/tiles";

// =============================================================================
// generateWall
// =============================================================================

describe("generateWall", () => {
  it("produces exactly 152 tiles", () => {
    const wall = generateWall();
    expect(wall).toHaveLength(152);
  });

  it("every tile has a unique id", () => {
    const wall = generateWall();
    const ids = wall.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(152);
  });

  it("every tile id matches its suit/val/copyIndex", () => {
    const wall = generateWall();
    for (const tile of wall) {
      expect(tile.id).toBe(tileId(tile.suit, tile.val, tile.copyIndex));
    }
  });

  it("every tile starts in_wall state with no owner", () => {
    const wall = generateWall();
    for (const tile of wall) {
      expect(tile.state).toBe("in_wall");
      expect(tile.owner).toBeNull();
      expect(tile.history).toHaveLength(0);
    }
  });

  it("contains exactly 108 suited tiles (dots, bams, cracks)", () => {
    const wall = generateWall();
    const suited = wall.filter((t) =>
      ["dots", "bams", "cracks"].includes(t.suit)
    );
    expect(suited).toHaveLength(108);
  });

  it("each suit has exactly 36 tiles (9 values × 4 copies)", () => {
    const wall = generateWall();
    for (const suit of ["dots", "bams", "cracks"] as Suit[]) {
      const suitTiles = wall.filter((t) => t.suit === suit);
      expect(suitTiles).toHaveLength(36);

      // Each value 1–9 has exactly 4 copies
      for (let val = 1; val <= 9; val++) {
        const valTiles = suitTiles.filter((t) => t.val === val);
        expect(valTiles).toHaveLength(4);
      }
    }
  });

  it("contains exactly 16 wind tiles (4 winds × 4 copies)", () => {
    const wall = generateWall();
    const winds = wall.filter((t) => t.suit === "wind");
    expect(winds).toHaveLength(16);

    for (const wind of ["E", "S", "W", "N"]) {
      const windTiles = winds.filter((t) => t.val === wind);
      expect(windTiles).toHaveLength(4);
    }
  });

  it("contains exactly 12 dragon tiles (3 dragons × 4 copies)", () => {
    const wall = generateWall();
    const dragons = wall.filter((t) => t.suit === "dragon");
    expect(dragons).toHaveLength(12);

    for (const dragon of ["red", "green", "white"]) {
      const dragonTiles = dragons.filter((t) => t.val === dragon);
      expect(dragonTiles).toHaveLength(4);
    }
  });

  it("contains exactly 8 flower tiles", () => {
    const wall = generateWall();
    const flowers = wall.filter((t) => t.suit === "flower");
    expect(flowers).toHaveLength(8);

    // copyIndex 1–8, each appearing once
    for (let copy = 1; copy <= 8; copy++) {
      const match = flowers.filter((t) => t.copyIndex === copy);
      expect(match).toHaveLength(1);
    }
  });

  it("contains exactly 8 joker tiles", () => {
    const wall = generateWall();
    const jokers = wall.filter((t) => t.suit === "joker");
    expect(jokers).toHaveLength(8);
  });

  it("tile counts sum correctly: 108 + 16 + 12 + 8 + 8 = 152", () => {
    const wall = generateWall();
    const suited = wall.filter((t) => ["dots", "bams", "cracks"].includes(t.suit)).length;
    const winds = wall.filter((t) => t.suit === "wind").length;
    const dragons = wall.filter((t) => t.suit === "dragon").length;
    const flowers = wall.filter((t) => t.suit === "flower").length;
    const jokers = wall.filter((t) => t.suit === "joker").length;
    expect(suited + winds + dragons + flowers + jokers).toBe(152);
  });
});

// =============================================================================
// shuffleWall
// =============================================================================

describe("shuffleWall", () => {
  it("returns the same array reference (in-place)", () => {
    const wall = generateWall();
    const ref = wall;
    shuffleWall(wall);
    expect(wall).toBe(ref);
  });

  it("still contains exactly 152 tiles after shuffle", () => {
    const wall = generateWall();
    shuffleWall(wall);
    expect(wall).toHaveLength(152);
  });

  it("produces a valid permutation — same tiles, possibly different order", () => {
    const wall = generateWall();
    const originalIds = wall.map((t) => t.id).sort();
    shuffleWall(wall);
    const shuffledIds = wall.map((t) => t.id).sort();
    expect(shuffledIds).toEqual(originalIds);
  });

  it("produces a different order from the original (statistically reliable across 3 runs)", () => {
    // The probability of a 152-element shuffle being identical to the original
    // is 1/152! ≈ 0 — this test will not produce a false failure in practice.
    let differentCount = 0;
    for (let run = 0; run < 3; run++) {
      const wall = generateWall();
      const originalIds = wall.map((t) => t.id).join(",");
      shuffleWall(wall);
      const shuffledIds = wall.map((t) => t.id).join(",");
      if (shuffledIds !== originalIds) differentCount++;
    }
    expect(differentCount).toBeGreaterThan(0);
  });

  it("all tiles retain their identity after shuffle", () => {
    const wall = generateWall();
    shuffleWall(wall);
    for (const tile of wall) {
      expect(tile.id).toBe(tileId(tile.suit, tile.val, tile.copyIndex));
      expect(tile.state).toBe("in_wall");
    }
  });
});

// =============================================================================
// dealHands
// =============================================================================

describe("dealHands", () => {
  function freshShuffledWall(): Tile[] {
    return shuffleWall(generateWall());
  }

  it("deals exactly 13 tiles to each of 4 players", () => {
    const wall = freshShuffledWall();
    const { hands } = dealHands(wall);
    for (const seat of SEAT_ORDER) {
      expect(hands[seat]).toHaveLength(13);
    }
  });

  it("remaining wall has exactly 100 tiles (152 − 52)", () => {
    const wall = freshShuffledWall();
    const { wall: remaining } = dealHands(wall);
    expect(remaining).toHaveLength(100);
  });

  it("dealt tiles are marked in_hand and assigned to the correct owner", () => {
    const wall = freshShuffledWall();
    const { hands } = dealHands(wall);
    for (const seat of SEAT_ORDER as PlayerId[]) {
      for (const tile of hands[seat]) {
        expect(tile.state).toBe("in_hand");
        expect(tile.owner).toBe(seat);
      }
    }
  });

  it("remaining wall tiles are still in_wall state", () => {
    const wall = freshShuffledWall();
    const { wall: remaining } = dealHands(wall);
    for (const tile of remaining) {
      expect(tile.state).toBe("in_wall");
    }
  });

  it("no tile appears in more than one hand or the remaining wall", () => {
    const wall = freshShuffledWall();
    const { hands, wall: remaining } = dealHands(wall);
    const allDealt = SEAT_ORDER.flatMap((seat) => hands[seat]);
    const allIds = new Set([...allDealt.map((t) => t.id), ...remaining.map((t) => t.id)]);
    // 52 dealt + 100 remaining = 152, all unique
    expect(allIds.size).toBe(152);
  });

  it("total tiles across all hands + remaining wall = 152", () => {
    const wall = freshShuffledWall();
    const { hands, wall: remaining } = dealHands(wall);
    const dealtCount = SEAT_ORDER.reduce((sum, seat) => sum + hands[seat].length, 0);
    expect(dealtCount + remaining.length).toBe(152);
  });

  it("throws if the wall does not have exactly 152 tiles", () => {
    const shortWall = generateWall().slice(0, 100);
    expect(() => dealHands(shortWall)).toThrow();
  });

  it("deals in seat order: E receives tiles 0–12, S tiles 13–25, etc.", () => {
    // Use an unshuffled wall so tile positions are deterministic
    const wall = generateWall();
    const wallSnapshot = wall.map((t) => t.id);
    const { hands } = dealHands(wall);

    // East's hand should contain the first 13 tiles
    const eastIds = hands["E"].map((t) => t.id);
    expect(eastIds).toEqual(wallSnapshot.slice(0, 13));

    // South's hand should contain tiles 13–25
    const southIds = hands["S"].map((t) => t.id);
    expect(southIds).toEqual(wallSnapshot.slice(13, 26));
  });


});
