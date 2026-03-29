import type { Suit, TileVal, SuitedVal, WindVal, DragonVal } from "@/engine/tiles";

// =============================================================================
// Display labels (tile → short text string)
// =============================================================================

/** Canonical short label for a tile, close to NMJL card notation. */
export function tileLabel(suit: Suit, val: TileVal): string {
  if (suit === "dots")   return `${val}d`;
  if (suit === "bams")   return `${val}b`;
  if (suit === "cracks") return `${val}c`;
  if (suit === "wind")   return val as string; // E / S / W / N
  if (suit === "dragon") {
    if (val === "red")   return "Red";
    if (val === "green") return "Grn";
    if (val === "white") return "Wht";
  }
  if (suit === "flower") return "Fl";
  if (suit === "joker")  return "Jkr";
  return String(val);
}

// =============================================================================
// Shorthand parser (user input → suit + val)
// =============================================================================

export interface ParsedTile {
  suit: Suit;
  val: TileVal;
}

/**
 * Parse a shorthand string into a tile identity.
 * Returns null if the input is unrecognized.
 *
 * Accepted formats (case-insensitive):
 *   Suited:  "1d" "5b" "9c"  (digit + d/b/c)
 *   Winds:   "e" "s" "w" "n"  or  "ew" "sw" "ww" "nw"
 *   Dragons: "r" "rd" "red"  |  "g" "gd" "grn" "green"  |  "wh" "wd" "wht" "white" "soap"
 *   Flower:  "f" "fl" "flower"
 *   Joker:   "j" "jk" "jkr" "joker"
 */
export function parseShorthand(raw: string): ParsedTile | null {
  const input = raw.trim().toLowerCase();
  if (!input) return null;

  // Suited tiles: digit + suit letter
  const suitedMatch = input.match(/^([1-9])([dbc])$/);
  if (suitedMatch) {
    const num = parseInt(suitedMatch[1], 10) as SuitedVal;
    const letter = suitedMatch[2];
    const suit: Suit =
      letter === "d" ? "dots" :
      letter === "b" ? "bams" :
      "cracks";
    return { suit, val: num };
  }

  // Winds
  if (["e", "ew"].includes(input)) return { suit: "wind", val: "E" as WindVal };
  if (["s", "sw"].includes(input)) return { suit: "wind", val: "S" as WindVal };
  if (["n", "nw"].includes(input)) return { suit: "wind", val: "N" as WindVal };
  // "w" alone is West wind; "wh"/"wd"/"wht"/"white"/"soap" are White dragon (checked below)
  if (input === "w" || input === "ww") return { suit: "wind", val: "W" as WindVal };

  // Dragons — checked after "w" to avoid conflict
  if (["r", "rd", "red"].includes(input))                return { suit: "dragon", val: "red"   as DragonVal };
  if (["g", "gd", "grn", "green"].includes(input))       return { suit: "dragon", val: "green" as DragonVal };
  if (["wh", "wd", "wht", "white", "soap"].includes(input)) return { suit: "dragon", val: "white" as DragonVal };

  // Flower
  if (["f", "fl", "flower"].includes(input)) return { suit: "flower", val: "flower" };

  // Joker
  if (["j", "jk", "jkr", "joker"].includes(input)) return { suit: "joker", val: "joker" };

  return null;
}

// =============================================================================
// All tile types for the picker grid (one entry per unique suit+val)
// =============================================================================

export interface TileType {
  suit: Suit;
  val: TileVal;
  label: string;
}

/** Ordered list of all unique tile types for rendering the picker grid. */
export const ALL_TILE_TYPES: TileType[] = [
  // Dots 1–9
  ...([1,2,3,4,5,6,7,8,9] as SuitedVal[]).map(v => ({ suit: "dots"   as Suit, val: v as TileVal, label: tileLabel("dots",   v) })),
  // Bams 1–9
  ...([1,2,3,4,5,6,7,8,9] as SuitedVal[]).map(v => ({ suit: "bams"   as Suit, val: v as TileVal, label: tileLabel("bams",   v) })),
  // Cracks 1–9
  ...([1,2,3,4,5,6,7,8,9] as SuitedVal[]).map(v => ({ suit: "cracks" as Suit, val: v as TileVal, label: tileLabel("cracks", v) })),
  // Winds
  ...( ["E","S","W","N"] as WindVal[]).map(v => ({ suit: "wind"   as Suit, val: v as TileVal, label: tileLabel("wind",   v) })),
  // Dragons
  ...(["red","green","white"] as DragonVal[]).map(v => ({ suit: "dragon" as Suit, val: v as TileVal, label: tileLabel("dragon", v) })),
  // Flower & Joker
  { suit: "flower" as Suit, val: "flower" as TileVal, label: "Fl"  },
  { suit: "joker"  as Suit, val: "joker"  as TileVal, label: "Jkr" },
];

// =============================================================================
// Tile sorting
// =============================================================================

const SUIT_SORT_ORDER: Record<Suit, number> = {
  dots: 0, bams: 1, cracks: 2, wind: 3, dragon: 4, flower: 5, joker: 6,
};

const WIND_SORT_ORDER: Record<string, number> = { E: 0, S: 1, W: 2, N: 3 };
const DRAGON_SORT_ORDER: Record<string, number> = { red: 0, green: 1, white: 2 };

function tileValSortKey(suit: Suit, val: TileVal): number {
  if (suit === "wind")   return WIND_SORT_ORDER[val as string] ?? 0;
  if (suit === "dragon") return DRAGON_SORT_ORDER[val as string] ?? 0;
  return typeof val === "number" ? val : 0;
}

import type { Tile } from "@/engine/tiles";

/**
 * Sort tiles for display: by suit group, then by value within suit.
 * Returns a new array — does not mutate the input.
 */
export function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => {
    const suitDiff = SUIT_SORT_ORDER[a.suit] - SUIT_SORT_ORDER[b.suit];
    if (suitDiff !== 0) return suitDiff;
    return tileValSortKey(a.suit, a.val) - tileValSortKey(b.suit, b.val);
  });
}
