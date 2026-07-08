// =============================================================================
// Fair per-seat hand analysis for multiplayer — an "unseen pool" model.
//
// Single-player's EvalPanel/PatternTracker run evaluateHand() against the real
// wall, which a multiplayer client never has (PlayerView only exposes a wall
// COUNT — see lib/server/redact.ts). Reusing evaluateHand() unchanged, this
// builds a SYNTHETIC wall sized by tile type rather than by physical position:
// for each tile type, `unseen = total copies − your hand − all discards − all
// exposed melds`. That total conflates "still in the wall" with "in an
// opponent's concealed hand" — which is exactly correct: a real player can't
// tell those apart either, so this is the honest amount of information they
// actually have (design doc §17).
//
// The one thing that must NOT come from the synthetic wall is the win-
// probability denominator (how many draws remain) — that needs the REAL wall
// count, which IS public (PlayerView.wallCount). So evaluateHand() is called
// against the synthetic wall for shanten/outs/reachability, then
// winProbability/liveWallSize are recomputed against the true count.
// =============================================================================

import { evaluateHand, computeWinProbability, type EvalResult } from "@/engine/evaluator";
import type { HandPatternTemplate } from "@/engine/patterns";
import { PATTERNS } from "@/engine/patterns";
import { tileId, getTileMaxCopies } from "@/engine/tiles";
import type { Tile, Suit, TileVal } from "@/engine/tiles";
import { ALL_TILE_TYPES } from "@/lib/shorthand";
import type { PlayerView } from "@/lib/server/redact";

function key(suit: Suit, val: TileVal): string {
  return `${suit}:${val}`;
}

/** A synthetic "wall" — one in_wall Tile per unseen copy of each tile type. */
export function buildUnseenPool(view: PlayerView): Tile[] {
  const seen = new Map<string, number>();
  const bump = (suit: Suit, val: TileVal) => {
    const k = key(suit, val);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  };

  for (const t of view.yourHand) bump(t.suit, t.val);
  for (const m of view.yourMelds) for (const t of m.tiles) bump(t.suit, t.val);
  for (const o of view.opponents) for (const m of o.melds) for (const t of m.tiles) bump(t.suit, t.val);
  for (const pile of Object.values(view.discardPile)) for (const t of pile) bump(t.suit, t.val);

  const pool: Tile[] = [];
  let synthCopy = 0;
  for (const { suit, val } of ALL_TILE_TYPES) {
    const max = getTileMaxCopies(suit);
    const already = seen.get(key(suit, val)) ?? 0;
    const unseen = Math.max(0, max - already);
    for (let i = 0; i < unseen; i++) {
      synthCopy++;
      pool.push({
        id: tileId(suit, val, 9000 + synthCopy),
        suit,
        val,
        copyIndex: 9000 + synthCopy,
        state: "in_wall",
        owner: null,
        history: [],
      });
    }
  }
  return pool;
}

/**
 * Hand analysis from a redacted PlayerView — safe to run entirely client-side
 * (it never receives anything the player couldn't already see).
 */
export function evaluateHandFromView(
  view: PlayerView,
  patterns: HandPatternTemplate[] = PATTERNS,
): EvalResult {
  const fullHand = [...view.yourHand, ...view.yourMelds.flatMap((m) => m.tiles)];
  const unseenPool = buildUnseenPool(view);
  const result = evaluateHand(fullHand, unseenPool, patterns);

  // Outs/shanten/reachability legitimately use the unseen pool (you don't know
  // whether an out is in the wall or an opponent's hand). But "how many draws
  // are left before the wall runs out" must use the REAL, public wall count —
  // the synthetic pool is larger than that and would overstate your odds.
  return {
    ...result,
    liveWallSize: view.wallCount,
    winProbability: computeWinProbability(result.shanten, result.totalOuts, view.wallCount),
  };
}
