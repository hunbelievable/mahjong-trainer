import type { Tile, Suit, TileVal, PlayerId } from "./tiles";
import type { HandPattern, HandPatternTemplate, PatternGroup } from "./patterns";
import { PATTERNS, CONCRETE_PATTERNS, instantiateTemplate } from "./patterns";

// =============================================================================
// Result types
// =============================================================================

export interface PatternMatch {
  pattern: HandPattern;       // concrete instantiation
  templateId: string;         // which template this came from
  /** Tiles still needed to complete this pattern. -1 = already complete. */
  shanten: number;
  /** How many hand tiles are already placed in this pattern. */
  tilesMatched: number;
}

export interface Out {
  suit: Suit;
  val: TileVal;
  /** Copies of this tile currently alive in the live wall. */
  liveCount: number;
}

export interface EvalResult {
  /** Best (lowest) shanten across all patterns. 0 = tenpai, -1 = complete. */
  shanten: number;
  /** All patterns at the best shanten number, ranked by tilesMatched desc. */
  bestPatterns: PatternMatch[];
  /** Tiles that would reduce shanten. Empty if shanten = -1. */
  outs: Out[];
  /** Total count of live out tiles in wall. */
  totalOuts: number;
  /** Win probability estimate (0–1). */
  winProbability: number;
  /** Size of the live wall used in the probability calculation. */
  liveWallSize: number;
}

export interface DiscardOption {
  tile: Tile;
  /** EvalResult after discarding this tile. */
  result: EvalResult;
  /** Positive = this discard improves things vs current best. */
  shantenDelta: number;
}

// =============================================================================
// Core: match a hand against a single pattern
// =============================================================================

/**
 * Count how many tiles in `hand` can be assigned to `group`.
 * Respects joker rules: jokers can fill any group where jokerLocked !== true.
 *
 * Returns { natural, withJokers } — natural tiles matched + jokers that could fill
 * the remaining slots. The caller decides how many jokers to actually allocate.
 */
function countGroupMatch(
  group: PatternGroup,
  naturalTileCounts: Map<string, number>,
  availableJokers: number
): { natural: number; jokerFill: number } {
  const key = `${group.suit}:${group.val}`;
  const natural = Math.min(naturalTileCounts.get(key) ?? 0, group.count);
  const deficit = group.count - natural;

  let jokerFill = 0;
  // NMJL: jokers may only fill groups of 3+ identical tiles (pung, kong, quint).
  // Singles and pairs must always be naturals.
  if (deficit > 0 && !group.jokerLocked && group.count >= 3) {
    jokerFill = Math.min(deficit, availableJokers);
  }

  return { natural, jokerFill };
}

/**
 * Compute shanten for a hand against one specific pattern.
 *
 * Algorithm:
 * 1. Build a frequency map of natural (non-joker) tiles in hand.
 * 2. Greedily match each group — natural tiles first, then jokers.
 * 3. shanten = tiles_still_needed - 1  (need 0 more = complete = shanten -1)
 *
 * Greedy matching is sufficient here because NMJL pattern groups are disjoint
 * (no two groups in the same pattern share the same suit+val).
 */
export function shantenForPattern(
  hand: Tile[],
  pattern: HandPattern
): PatternMatch {
  // Build natural tile frequency map (exclude jokers)
  const freq = new Map<string, number>();
  let jokerCount = 0;

  for (const tile of hand) {
    if (tile.suit === "joker") {
      jokerCount++;
    } else {
      const key = `${tile.suit}:${tile.val}`;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }

  let totalMatched = 0;
  let jokersUsed = 0;

  for (const group of pattern.groups) {
    const key = `${group.suit}:${group.val}`;
    const naturalInHand = freq.get(key) ?? 0;
    const natural = Math.min(naturalInHand, group.count);

    // Remove matched natural tiles from pool so they can't double-count
    freq.set(key, naturalInHand - natural);
    totalMatched += natural;

    // Fill remaining slots with jokers (NMJL: only groups of 3+ accept jokers)
    const deficit = group.count - natural;
    if (deficit > 0 && !group.jokerLocked && group.count >= 3) {
      const fill = Math.min(deficit, jokerCount - jokersUsed);
      totalMatched += fill;
      jokersUsed += fill;
    }
  }

  // Unallocated jokers can't help further (all groups already processed)
  const tilesNeeded = pattern.totalTiles - totalMatched;
  const shanten = tilesNeeded - 1; // tenpai = need exactly 1 tile = shanten 0

  return {
    pattern,
    templateId: pattern.id.replace(/_\d+$/, ""),  // strip instance suffix
    shanten,
    tilesMatched: totalMatched,
  };
}

// =============================================================================
// Core: evaluate hand across all patterns
// =============================================================================

function getLiveWall(wall: Tile[]): Tile[] {
  return wall.filter(t => t.state === "in_wall");
}

/**
 * Count live copies of a specific tile type in the live wall.
 */
function liveCount(suit: Suit, val: TileVal, liveWall: Tile[]): number {
  return liveWall.filter((t) => t.suit === suit && t.val === val).length;
}

/**
 * Enumerate all (suit, val) combinations present in the full tile set.
 * Used to iterate over possible draws without needing a full wall reference.
 */
function allTileTypes(): Array<{ suit: Suit; val: TileVal }> {
  const types: Array<{ suit: Suit; val: TileVal }> = [];
  for (const suit of ["dots", "bams", "cracks"] as Suit[]) {
    for (let v = 1; v <= 9; v++) {
      types.push({ suit, val: v as TileVal });
    }
  }
  for (const val of ["E", "S", "W", "N"] as TileVal[]) {
    types.push({ suit: "wind", val });
  }
  for (const val of ["red", "green", "white"] as TileVal[]) {
    types.push({ suit: "dragon", val });
  }
  types.push({ suit: "flower", val: "flower" });
  types.push({ suit: "joker",  val: "joker" });
  return types;
}

// =============================================================================
// Win probability: outs-based sequential draw model
// =============================================================================

/**
 * Estimate the probability of winning before the wall runs out.
 *
 * Model:
 * - For tenpai (shanten = 0): P = total_outs / live_wall_size
 *   Interpretable as: "probability of winning on your very next draw."
 *   For training purposes this is the most actionable number.
 *
 * - For shanten N > 0: we model each shanten-reduction step as an independent
 *   draw event. At each step the wall shrinks by AVG_DRAWS_PER_STEP (how many
 *   tiles are drawn across all players per "round"). We use current outs as a
 *   conservative estimate for all future steps.
 *
 *   P = ∏(i=0..N) { outs / (live_wall - i * AVG_DRAWS_PER_STEP) }
 *
 * This is an approximation; a full Monte Carlo simulation (Phase 7 Observe mode)
 * will give empirical ground truth for validation.
 */
const AVG_DRAWS_PER_STEP = 4; // ~1 round of draws (4 players × 1 tile)

export function computeWinProbability(
  shanten: number,
  totalOuts: number,
  liveWallSize: number
): number {
  if (shanten < 0) return 1;          // already won
  if (liveWallSize <= 0) return 0;
  if (totalOuts <= 0) return 0;

  let prob = 1;
  let wall = liveWallSize;

  for (let step = 0; step <= shanten; step++) {
    if (wall <= 0) return 0;
    const p = Math.min(1, totalOuts / wall);
    prob *= p;
    wall = Math.max(1, wall - AVG_DRAWS_PER_STEP);
  }

  return Math.min(1, prob);
}

// =============================================================================
// Main evaluator
// =============================================================================

/**
 * Fully evaluate a player's hand against all patterns.
 *
 * @param hand   The player's current tiles (13 or 14 tiles)
 * @param wall   The full remaining wall (used to count live tiles for outs)
 * @param patterns  Pattern library to evaluate against (defaults to PATTERNS)
 */
export function evaluateHand(
  hand: Tile[],
  wall: Tile[],
  patterns: HandPatternTemplate[] = PATTERNS
): EvalResult {
  // Expand templates to concrete patterns (use cached array for default)
  const concrete: HandPattern[] =
    patterns === PATTERNS
      ? CONCRETE_PATTERNS
      : patterns.flatMap(instantiateTemplate);

  // Score hand against every concrete pattern
  const allMatches = concrete.map((p) => shantenForPattern(hand, p));

  // Find best (lowest) shanten
  const bestShanten = Math.min(...allMatches.map((m) => m.shanten));

  // Collect all patterns at best shanten, ranked by tiles already matched
  const bestPatterns = allMatches
    .filter((m) => m.shanten === bestShanten)
    .sort((a, b) => b.tilesMatched - a.tilesMatched);

  const liveWall = getLiveWall(wall);
  const liveWallSize = liveWall.length;

  // Compute outs: tiles that would reduce shanten for at least one best pattern
  const outs: Out[] = [];

  if (bestShanten >= 0) {
    for (const { suit, val } of allTileTypes()) {
      // Build a test hand with one copy of this tile added
      const fakeTile: Tile = {
        id: `__test_${suit}_${val}`,
        suit,
        val,
        copyIndex: 99,
        state: "in_hand",
        owner: null,
        history: [],
      };
      const testHand = [...hand, fakeTile];

      // Check if any pattern improves
      const improves = bestPatterns.some((m) => {
        const newMatch = shantenForPattern(testHand, m.pattern);
        return newMatch.shanten < bestShanten;
      });

      if (improves) {
        const count = liveCount(suit, val, liveWall);
        if (count > 0) {
          outs.push({ suit, val, liveCount: count });
        }
      }
    }
  }

  const totalOuts = outs.reduce((sum, o) => sum + o.liveCount, 0);
  const winProbability = computeWinProbability(bestShanten, totalOuts, liveWallSize);

  return {
    shanten: bestShanten,
    bestPatterns,
    outs,
    totalOuts,
    winProbability,
    liveWallSize,
  };
}

// =============================================================================
// Discard suggestion
// =============================================================================

/**
 * For a 14-tile hand (after a draw), evaluate every possible discard and rank
 * by: (1) lowest resulting shanten, (2) highest win probability, (3) most outs.
 *
 * Returns options sorted best-first.
 */
export function bestDiscard(
  hand: Tile[],
  wall: Tile[],
  patterns: HandPatternTemplate[] = PATTERNS
): DiscardOption[] {
  if (hand.length < 1) return [];

  const currentEval = evaluateHand(hand, wall, patterns);

  const options: DiscardOption[] = hand.map((tile) => {
    const handAfterDiscard = hand.filter((t) => t.id !== tile.id);
    const result = evaluateHand(handAfterDiscard, wall, patterns);
    return {
      tile,
      result,
      shantenDelta: currentEval.shanten - result.shanten,
    };
  });

  // Sort: best shanten first, then most outs, then highest win probability
  return options.sort((a, b) => {
    if (a.result.shanten !== b.result.shanten) {
      return a.result.shanten - b.result.shanten;
    }
    if (a.result.totalOuts !== b.result.totalOuts) {
      return b.result.totalOuts - a.result.totalOuts;
    }
    return b.result.winProbability - a.result.winProbability;
  });
}
