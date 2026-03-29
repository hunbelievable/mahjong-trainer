import { describe, it, expect } from "vitest";
import { parseShorthand, tileLabel, ALL_TILE_TYPES } from "@/lib/shorthand";

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
