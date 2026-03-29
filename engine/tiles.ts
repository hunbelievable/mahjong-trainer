// =============================================================================
// Tile types & identity
// =============================================================================

export type Suit = "dots" | "bams" | "cracks" | "wind" | "dragon" | "flower" | "joker";

/** 1–9 for suited tiles */
export type SuitedVal = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type WindVal = "E" | "S" | "W" | "N";

/** Red = 中 (Chun), Green = 發 (Hatsu), White = 白 (Haku / Soap) */
export type DragonVal = "red" | "green" | "white";

export type TileVal = SuitedVal | WindVal | DragonVal | "flower" | "joker";

export interface TileIdentity {
  suit: Suit;
  val: TileVal;
  /** 1-based index to distinguish identical tiles (e.g. the 2nd 3-dots) */
  copyIndex: number;
}

// =============================================================================
// Tile lifecycle
// =============================================================================

export type TileState =
  | "in_wall"       // Face-down in the live wall, not yet drawn
  | "in_hand"       // In a player's hand (concealed)
  | "discarded"     // On the board in a player's discard row
  | "claimed_pung"  // Taken from a discard to form an exposed pung (3 of a kind)
  | "claimed_kong"  // Taken to form an exposed kong (4 of a kind)
  | "claimed_quint" // Taken to form an exposed quint (5 with joker)
  | "melded"        // Exposed on the table
  | "joker_swapped" // A joker that was replaced out of an exposed meld by a natural tile
  | "out_of_game";  // Removed from play (should not occur in normal flow)

export interface TileEvent {
  turn: number;
  from: TileState;
  to: TileState;
  actor: PlayerId;
  reason?: string;
}

export interface Tile extends TileIdentity {
  /** Globally unique. Format: "{suit}_{val}_{copyIndex}" e.g. "dots_3_2" */
  id: string;
  state: TileState;
  owner: PlayerId | null;
  turnDrawn?: number;
  turnDiscarded?: number;
  history: TileEvent[];
}

// =============================================================================
// Player types
// =============================================================================

export type PlayerId = "E" | "S" | "W" | "N"; // East, South, West, North seats

// =============================================================================
// Wall generation
// =============================================================================

/**
 * Build the tile ID string from its components.
 * Keeps IDs consistent everywhere — always derive via this function.
 */
export function tileId(suit: Suit, val: TileVal, copyIndex: number): string {
  return `${suit}_${val}_${copyIndex}`;
}

/**
 * Create a blank tile record (all tiles start in the wall, unowned).
 */
function makeTile(suit: Suit, val: TileVal, copyIndex: number): Tile {
  return {
    id: tileId(suit, val, copyIndex),
    suit,
    val,
    copyIndex,
    state: "in_wall",
    owner: null,
    history: [],
  };
}

/**
 * Generate all 152 American Mahjong tiles in wall order (unsorted).
 *
 * Composition:
 *   108 suited  — dots, bams, cracks (1–9 × 4 copies each suit)
 *    16 winds   — E, S, W, N (4 copies each)
 *    12 dragons — red, green, white (4 copies each)
 *     8 flowers — flower_1 through flower_8 (1 copy each, all functionally equivalent)
 *     8 jokers  — joker_1 through joker_8
 *   ─────────
 *   152 total
 */
export function generateWall(): Tile[] {
  const tiles: Tile[] = [];

  // Suited tiles: dots, bams, cracks — values 1–9, 4 copies each
  const suits: Array<"dots" | "bams" | "cracks"> = ["dots", "bams", "cracks"];
  for (const suit of suits) {
    for (let val = 1; val <= 9; val++) {
      for (let copy = 1; copy <= 4; copy++) {
        tiles.push(makeTile(suit, val as SuitedVal, copy));
      }
    }
  }

  // Wind tiles: E, S, W, N — 4 copies each
  const winds: WindVal[] = ["E", "S", "W", "N"];
  for (const wind of winds) {
    for (let copy = 1; copy <= 4; copy++) {
      tiles.push(makeTile("wind", wind, copy));
    }
  }

  // Dragon tiles: red, green, white — 4 copies each
  const dragons: DragonVal[] = ["red", "green", "white"];
  for (const dragon of dragons) {
    for (let copy = 1; copy <= 4; copy++) {
      tiles.push(makeTile("dragon", dragon, copy));
    }
  }

  // Flower tiles: 8 unique flowers, treated as functionally equivalent in hand evaluation
  // copyIndex encodes which physical flower it is (1–8)
  for (let copy = 1; copy <= 8; copy++) {
    tiles.push(makeTile("flower", "flower", copy));
  }

  // Joker tiles: 8 wild tiles
  for (let copy = 1; copy <= 8; copy++) {
    tiles.push(makeTile("joker", "joker", copy));
  }

  return tiles;
}

// =============================================================================
// Wall shuffle
// =============================================================================

/**
 * Fisher-Yates in-place shuffle. Returns the same array for chaining.
 * Uses Math.random() — suitable for gameplay, not cryptography.
 */
export function shuffleWall(wall: Tile[]): Tile[] {
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

// =============================================================================
// Deal
// =============================================================================

export interface DealtHands {
  /** Each player's starting 13-tile hand, keyed by seat */
  hands: Record<PlayerId, Tile[]>;
  /**
   * Remaining live wall after dealing (100 tiles).
   * Index 0 = next tile to draw.
   */
  wall: Tile[];
}

/** Seat order for dealing: East deals first, then South, West, North. */
export const SEAT_ORDER: PlayerId[] = ["E", "S", "W", "N"];

/**
 * Deal 13 tiles to each of 4 players from the front of a shuffled wall.
 * Tiles are marked as in_hand and assigned to their owner.
 *
 * After dealing:
 *   - Each player holds exactly 13 tiles
 *   - The live wall has 100 tiles (152 − 52)
 */
export function dealHands(wall: Tile[]): DealtHands {
  if (wall.length !== 152) {
    throw new Error(`Expected 152 tiles, got ${wall.length}`);
  }

  const hands: Record<PlayerId, Tile[]> = { E: [], S: [], W: [], N: [] };
  let wallIndex = 0;

  // Deal 13 tiles to each player in seat order
  for (const seat of SEAT_ORDER) {
    for (let i = 0; i < 13; i++) {
      const tile = wall[wallIndex++];
      tile.state = "in_hand";
      tile.owner = seat;
      hands[seat].push(tile);
    }
  }

  // Remaining tiles stay in their current state ('in_wall')
  return {
    hands,
    wall: wall.slice(wallIndex),
  };
}

// =============================================================================
// Utility helpers (used by evaluator and engine)
// =============================================================================

/**
 * Count how many copies of a given tile identity remain in the live wall
 * (state === 'in_wall').
 */
export function countLiveInWall(
  suit: Suit,
  val: TileVal,
  wall: Tile[],
): number {
  const liveWall = wall;
  return liveWall.filter((t) => t.suit === suit && t.val === val && t.state === "in_wall").length;
}

/**
 * Return the count of copies of a tile that are fully dead
 * (all 4 copies discarded — not applicable to flowers/jokers which have 8 copies).
 */
export function getTileMaxCopies(suit: Suit): number {
  if (suit === "flower" || suit === "joker") return 8;
  return 4;
}
