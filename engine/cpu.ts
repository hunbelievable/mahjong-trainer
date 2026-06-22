import type { Tile, PlayerId } from "./tiles";
import type { EvalResult } from "./evaluator";
import { evaluateHand, bestDiscard } from "./evaluator";
import type { HandPatternTemplate } from "./patterns";
import { PATTERNS } from "./patterns";

// =============================================================================
// Claim types
// =============================================================================

export type ClaimType = "pung" | "kong" | "quint" | "mahjong";

// =============================================================================
// Strategy interface
// =============================================================================

/**
 * A CpuStrategy is a pure decision-maker. It receives game state snapshots
 * and returns decisions. No side effects — easy to swap, test, or extend.
 *
 * Both methods receive the wall so strategies can factor in remaining tiles.
 */
export interface CpuStrategy {
  readonly name: string;
  readonly difficulty: "beginner" | "intermediate" | "advanced" | "random" | "custom";

  /**
   * Choose a tile to discard from a 14-tile hand.
   * Must return a tile that is present in `hand`.
   */
  chooseDiscard(
    hand: Tile[],
    evalResult: EvalResult,
    wall: Tile[],
    patterns?: HandPatternTemplate[]
  ): Tile;

  /**
   * Decide whether to claim a discarded tile for the given type.
   * Called once per eligible claim type (mahjong checked first).
   */
  shouldClaim(
    discard: Tile,
    hand: Tile[],
    claimType: ClaimType,
    wall: Tile[],
    patterns?: HandPatternTemplate[]
  ): boolean;
}

// =============================================================================
// Helpers shared across strategies
// =============================================================================

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Tiles the claimant must surrender from hand to complete a pung/kong/quint.
 * Naturals first, jokers fill any remaining slots. The discarded tile itself
 * counts as one matching tile, so jokers alone can cover the rest.
 * Returns null if the claim is not legal (not enough naturals+jokers to fill).
 */
function tilesToSurrender(hand: Tile[], discard: Tile, needed: number): Tile[] | null {
  const naturals = hand.filter(t => t.suit === discard.suit && t.val === discard.val).slice(0, needed);
  const remaining = needed - naturals.length;
  if (remaining === 0) return naturals;
  const jokers = hand.filter(t => t.suit === "joker").slice(0, remaining);
  if (naturals.length + jokers.length < needed) return null;
  return [...naturals, ...jokers];
}

// =============================================================================
// Strategy 1: Random
// =============================================================================

/**
 * Discards a random tile from its hand. Claims randomly (50/50).
 * Useful as a baseline and for stress-testing the game engine.
 */
export const randomStrategy: CpuStrategy = {
  name: "Random",
  difficulty: "random",

  chooseDiscard(hand) {
    return randomItem(hand);
  },

  shouldClaim() {
    return Math.random() < 0.5;
  },
};

// =============================================================================
// Strategy 2: Greedy
// =============================================================================

/**
 * Always follows the evaluator's top discard suggestion.
 * Claims whenever the claim is net positive (improves shanten or wins).
 * No randomness — pure optimal play. Acts as the upper bound for comparison.
 */
export const greedyStrategy: CpuStrategy = {
  name: "Greedy",
  difficulty: "advanced",

  chooseDiscard(hand, evalResult, wall, patterns = PATTERNS) {
    if (hand.length !== 14) return randomItem(hand);
    const options = bestDiscard(hand, wall, patterns);
    return options[0]?.tile ?? randomItem(hand);
  },

  shouldClaim(discard, hand, claimType, wall, patterns = PATTERNS) {
    if (claimType === "mahjong") {
      // Claim mahjong if adding this tile completes the hand
      const testHand = [...hand, discard];
      const result = evaluateHand(testHand, wall, patterns);
      return result.shanten === -1;
    }

    // Claim pung/kong/quint if we can legally form it and it improves position
    const needed = claimType === "pung" ? 2 : claimType === "kong" ? 3 : 4;
    const surrender = tilesToSurrender(hand, discard, needed);
    if (!surrender) return false;

    const before = evaluateHand(hand, wall, patterns).shanten;
    const handAfterClaim = hand.filter(t => !surrender.includes(t));
    const after = evaluateHand(handAfterClaim, wall, patterns).shanten;
    return after <= before;
  },
};

// =============================================================================
// Strategy 3: Probabilistic (the main difficulty-tunable strategy)
// =============================================================================

export interface ProbabilisticConfig {
  /**
   * Probability of making a random discard instead of the optimal one.
   * 0.0 = always optimal, 1.0 = always random.
   */
  epsilon: number;

  /**
   * Minimum win probability of the resulting hand to justify a pung/kong claim.
   * Mahjong claims are always taken regardless of this threshold.
   */
  claimThreshold: number;

  /**
   * Optional label for this configuration.
   */
  label?: string;
}

export function createProbabilisticStrategy(
  config: ProbabilisticConfig,
  difficultyLabel: CpuStrategy["difficulty"] = "custom"
): CpuStrategy {
  return {
    name: config.label ?? `Probabilistic (ε=${config.epsilon})`,
    difficulty: difficultyLabel,

    chooseDiscard(hand, evalResult, wall, patterns = PATTERNS) {
      if (hand.length !== 14) return randomItem(hand);

      // With probability epsilon, pick a random tile (mistake / curveball)
      if (Math.random() < config.epsilon) {
        return randomItem(hand);
      }

      // Otherwise follow the evaluator
      const options = bestDiscard(hand, wall, patterns);
      return options[0]?.tile ?? randomItem(hand);
    },

    shouldClaim(discard, hand, claimType, wall, patterns = PATTERNS) {
      // Always take mahjong
      if (claimType === "mahjong") {
        const testHand = [...hand, discard];
        const result = evaluateHand(testHand, wall, patterns);
        return result.shanten === -1;
      }

      const needed = claimType === "pung" ? 2 : claimType === "kong" ? 3 : 4;
      const surrender = tilesToSurrender(hand, discard, needed);
      if (!surrender) return false;

      // With epsilon chance, make a random claim decision
      if (Math.random() < config.epsilon) {
        return Math.random() < 0.5;
      }

      // Otherwise claim only if the resulting hand meets the win probability threshold
      const handAfterClaim = hand.filter(t => !surrender.includes(t));
      const result = evaluateHand(handAfterClaim, wall, patterns);
      return result.winProbability >= config.claimThreshold;
    },
  };
}

// =============================================================================
// Difficulty presets
// =============================================================================

export const DIFFICULTY_PRESETS = {
  beginner: createProbabilisticStrategy(
    { epsilon: 0.40, claimThreshold: 0.05, label: "Beginner" },
    "beginner"
  ),
  intermediate: createProbabilisticStrategy(
    { epsilon: 0.15, claimThreshold: 0.15, label: "Intermediate" },
    "intermediate"
  ),
  advanced: createProbabilisticStrategy(
    { epsilon: 0.03, claimThreshold: 0.25, label: "Advanced" },
    "advanced"
  ),
} as const;

export type DifficultyLevel = keyof typeof DIFFICULTY_PRESETS;

/** Per-seat strategy assignment for a simulation game. */
export type SeatStrategies = Partial<Record<PlayerId, CpuStrategy>>;

// =============================================================================
// Charleston helpers
// =============================================================================

/**
 * Choose 3 tiles to pass during a Charleston exchange.
 * Jokers may never be passed. Uses a greedy sequential approach:
 * repeatedly remove the tile whose absence most improves the remaining hand.
 */
export function chooseTilesForCharleston(
  strategy: CpuStrategy,
  hand: Tile[],
  wall: Tile[],
  patterns: HandPatternTemplate[] = PATTERNS,
  count: number = 3
): Tile[] {
  const passable = hand.filter(t => t.suit !== "joker");
  if (passable.length < count) return passable.slice(0, Math.min(count, passable.length));

  if (strategy.difficulty === "random") {
    return [...passable].sort(() => Math.random() - 0.5).slice(0, count);
  }

  // Greedy sequential: find worst tile, remove it, repeat
  const toPass: Tile[] = [];
  let remaining = [...hand];

  for (let i = 0; i < count; i++) {
    const candidates = remaining.filter(t => t.suit !== "joker");
    if (candidates.length === 0) break;

    let worstTile = candidates[0];
    let bestShanten = Infinity;
    let bestWinProb = -1;

    for (const tile of candidates) {
      const afterRemoval = remaining.filter(t => t.id !== tile.id);
      const result = evaluateHand(afterRemoval, wall, patterns);
      if (
        result.shanten < bestShanten ||
        (result.shanten === bestShanten && result.winProbability > bestWinProb)
      ) {
        bestShanten = result.shanten;
        bestWinProb = result.winProbability;
        worstTile = tile;
      }
    }

    toPass.push(worstTile);
    remaining = remaining.filter(t => t.id !== worstTile.id);
  }

  return toPass;
}

/**
 * Decide whether to stop the Second Charleston (call before step 3 begins).
 * Returns true if this strategy would rather skip Second Charleston.
 */
export function shouldStopCharleston(
  strategy: CpuStrategy,
  hand: Tile[],
  wall: Tile[],
  patterns: HandPatternTemplate[] = PATTERNS
): boolean {
  if (strategy.difficulty === "random") return false;

  const result = evaluateHand(hand, wall, patterns);

  // Already tenpai or one away — no need for more passing
  if (result.shanten <= 1) return true;

  const threshold: Record<string, number> = {
    beginner: 0.40,
    intermediate: 0.25,
    advanced: 0.15,
    custom: 0.20,
    random: 1.00,
  };

  return result.winProbability >= (threshold[strategy.difficulty] ?? 0.25);
}

/**
 * Propose a courtesy-pass count (0–3) after the Second Charleston. Heuristic:
 * worse the hand, more tiles you're willing to swap.
 *  shanten <= 1 → 0 (don't risk a hand that's almost there)
 *  shanten 2–3 → 1
 *  shanten 4–5 → 2
 *  shanten 6+  → 3
 * Random strategy proposes a uniformly random count.
 */
export function chooseCourtesyCount(
  strategy: CpuStrategy,
  hand: Tile[],
  wall: Tile[],
  patterns: HandPatternTemplate[] = PATTERNS
): number {
  if (strategy.difficulty === "random") {
    return Math.floor(Math.random() * 4);
  }
  const result = evaluateHand(hand, wall, patterns);
  if (result.shanten <= 1) return 0;
  if (result.shanten <= 3) return 1;
  if (result.shanten <= 5) return 2;
  return 3;
}
