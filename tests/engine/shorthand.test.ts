import { describe, it, expect } from "vitest";
import { parseShorthand, tileLabel, ALL_TILE_TYPES, applyCustomOrder } from "@/lib/shorthand";
import { tileId, type Tile, type Suit, type TileVal } from "@/engine/tiles";

describe("parseShorthand", () => {
  // Suited tiles
  it("parses dots: 1d through 9d", () => {
    for (let v = 1; v <= 9; v++) {
      const result = parseShorthand(`${v}d`);
      expect(result).not.toBeNull();
      expect(result!.suit).toBe("dots");
      expect(result!.val).toBe(v);
    }
  });

  it("parses bams: 1b through 9b", () => {
    for (let v = 1; v <= 9; v++) {
      const result = parseShorthand(`${v}b`);
      expect(result!.suit).toBe("bams");
      expect(result!.val).toBe(v);
    }
  });

  it("parses cracks: 1c through 9c", () => {
    for (let v = 1; v <= 9; v++) {
      const result = parseShorthand(`${v}c`);
      expect(result!.suit).toBe("cracks");
      expect(result!.val).toBe(v);
    }
  });

  // Winds
  it.each([
    ["e",  "E"], ["ew", "E"],
    ["s",  "S"], ["sw", "S"],
    ["n",  "N"], ["nw", "N"],
  ])('parses "%s" as wind %s', (input, expected) => {
    const result = parseShorthand(input);
    expect(result!.suit).toBe("wind");
    expect(result!.val).toBe(expected);
  });

  it('parses "w" and "ww" as West wind', () => {
    expect(parseShorthand("w")!.val).toBe("W");
    expect(parseShorthand("ww")!.val).toBe("W");
  });

  // Dragons
  it.each([
    ["r",    "red"],
    ["rd",   "red"],
    ["red",  "red"],
    ["g",    "green"],
    ["gd",   "green"],
    ["grn",  "green"],
    ["green","green"],
    ["wh",   "white"],
    ["wd",   "white"],
    ["wht",  "white"],
    ["white","white"],
    ["soap", "white"],
  ])('parses "%s" as dragon %s', (input, expected) => {
    const result = parseShorthand(input);
    expect(result!.suit).toBe("dragon");
    expect(result!.val).toBe(expected);
  });

  // Flower
  it.each(["f", "fl", "flower"])('parses "%s" as flower', input => {
    const result = parseShorthand(input);
    expect(result!.suit).toBe("flower");
    expect(result!.val).toBe("flower");
  });

  // Joker
  it.each(["j", "jk", "jkr", "joker"])('parses "%s" as joker', input => {
    const result = parseShorthand(input);
    expect(result!.suit).toBe("joker");
    expect(result!.val).toBe("joker");
  });

  // Case insensitive
  it("is case-insensitive", () => {
    expect(parseShorthand("5D")!.suit).toBe("dots");
    expect(parseShorthand("RED")!.val).toBe("red");
    expect(parseShorthand("JKR")!.suit).toBe("joker");
    expect(parseShorthand("E")!.val).toBe("E");
  });

  // Whitespace trimming
  it("trims leading/trailing whitespace", () => {
    expect(parseShorthand("  3b  ")!.val).toBe(3);
  });

  // Unknown input
  it("returns null for unrecognized input", () => {
    expect(parseShorthand("")).toBeNull();
    expect(parseShorthand("xyz")).toBeNull();
    expect(parseShorthand("10d")).toBeNull();
    expect(parseShorthand("0b")).toBeNull();
  });

  // West wind vs white dragon disambiguation
  it("w/ww = West wind, wh/wd/wht = White dragon", () => {
    expect(parseShorthand("w")!.suit).toBe("wind");
    expect(parseShorthand("w")!.val).toBe("W");
    expect(parseShorthand("wh")!.suit).toBe("dragon");
    expect(parseShorthand("wh")!.val).toBe("white");
  });
});

describe("tileLabel", () => {
  it("formats suited tiles correctly", () => {
    expect(tileLabel("dots",   1)).toBe("1d");
    expect(tileLabel("bams",   5)).toBe("5b");
    expect(tileLabel("cracks", 9)).toBe("9c");
  });

  it("formats winds correctly", () => {
    expect(tileLabel("wind", "E")).toBe("E");
    expect(tileLabel("wind", "N")).toBe("N");
  });

  it("formats dragons correctly", () => {
    expect(tileLabel("dragon", "red")).toBe("Red");
    expect(tileLabel("dragon", "green")).toBe("Grn");
    expect(tileLabel("dragon", "white")).toBe("Wht");
  });

  it("formats flower and joker", () => {
    expect(tileLabel("flower", "flower")).toBe("Fl");
    expect(tileLabel("joker",  "joker")).toBe("Jkr");
  });
});

describe("ALL_TILE_TYPES", () => {
  it("contains exactly 34 unique tile types", () => {
    // 9 dots + 9 bams + 9 cracks + 4 winds + 3 dragons + 1 flower + 1 joker = 36
    expect(ALL_TILE_TYPES).toHaveLength(36);
  });

  it("all labels are non-empty strings", () => {
    for (const t of ALL_TILE_TYPES) {
      expect(typeof t.label).toBe("string");
      expect(t.label.length).toBeGreaterThan(0);
    }
  });

  it("every tile type has a label matching tileLabel(suit, val)", () => {
    for (const t of ALL_TILE_TYPES) {
      expect(t.label).toBe(tileLabel(t.suit, t.val));
    }
  });
});

describe("applyCustomOrder", () => {
  // Minimal tile factory — applyCustomOrder only reads id/suit/val.
  function mk(suit: Suit, val: TileVal, copy = 1): Tile {
    return {
      id: tileId(suit, val, copy),
      suit,
      val,
      copyIndex: copy,
      state: "in_hand",
      owner: "E",
      history: [],
    };
  }
  const ids = (tiles: Tile[]) => tiles.map(t => t.id);

  it("preserves the saved arrangement for tiles still held", () => {
    const hand = [mk("cracks", 9), mk("dots", 2), mk("bams", 6)];
    const order = ids(hand); // already in a custom (non-sorted) order
    expect(ids(applyCustomOrder(order, hand))).toEqual(order);
  });

  it("drops tiles no longer in the hand (e.g. discarded)", () => {
    const d2 = mk("dots", 2, 1);
    const d2b = mk("dots", 2, 2);
    const b6 = mk("bams", 6);
    const c3 = mk("cracks", 3);
    const order = ids([d2, d2b, b6, c3]);
    const hand = [d2, d2b, c3]; // b6 discarded
    expect(ids(applyCustomOrder(order, hand))).toEqual(ids([d2, d2b, c3]));
  });

  it("auto-inserts a drawn suited tile next to its suit, in value order", () => {
    const d2 = mk("dots", 2, 1);
    const d2b = mk("dots", 2, 2);
    const b6 = mk("bams", 6);
    const c3 = mk("cracks", 3);
    const c9 = mk("cracks", 9);
    const order = ids([d2, d2b, b6, c3, c9]);
    const d5 = mk("dots", 5);
    const hand = [d2, d2b, b6, c3, c9, d5]; // 5d freshly drawn
    // 5d slots after the 2-dots, before the bams — among dots, value order
    expect(ids(applyCustomOrder(order, hand))).toEqual(
      ids([d2, d2b, d5, b6, c3, c9]),
    );
  });

  it("inserts a drawn tile of an absent suit at the correct suit boundary", () => {
    const d2 = mk("dots", 2);
    const c9 = mk("cracks", 9);
    const order = ids([d2, c9]);
    const b5 = mk("bams", 5);
    const hand = [d2, c9, b5]; // bams not yet present
    // bams sit between dots and cracks
    expect(ids(applyCustomOrder(order, hand))).toEqual(ids([d2, b5, c9]));
  });

  it("sends a drawn honor/joker to the end (highest suit order)", () => {
    const d2 = mk("dots", 2);
    const b5 = mk("bams", 5);
    const order = ids([d2, b5]);
    const wd = mk("dragon", "white");
    const hand = [d2, b5, wd];
    expect(ids(applyCustomOrder(order, hand))).toEqual(ids([d2, b5, wd]));
  });

  it("builds a suit/value-grouped order when no arrangement exists yet", () => {
    const hand = [
      mk("dragon", "red"),
      mk("dots", 6),
      mk("bams", 5),
      mk("dots", 2),
      mk("cracks", 9),
      mk("dots", 4),
    ];
    const result = applyCustomOrder([], hand);
    expect(ids(result)).toEqual(
      ids([
        mk("dots", 2),
        mk("dots", 4),
        mk("dots", 6),
        mk("bams", 5),
        mk("cracks", 9),
        mk("dragon", "red"),
      ]),
    );
  });

  it("does not mutate its inputs", () => {
    const hand = [mk("dots", 2), mk("bams", 6)];
    const order = ids([hand[1], hand[0]]); // reversed
    const orderCopy = [...order];
    const handCopy = [...hand];
    applyCustomOrder(order, hand);
    expect(order).toEqual(orderCopy);
    expect(hand).toEqual(handCopy);
  });
});
