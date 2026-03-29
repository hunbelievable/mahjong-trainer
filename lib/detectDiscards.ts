import type { Tile, PlayerId } from "@/engine/tiles";
import type { GameState } from "@/engine/gameEngine";
import { evaluateHand } from "@/engine/evaluator";
import type { SaveMovePayload } from "@/app/api/games/[id]/moves/route";

const SEATS: PlayerId[] = ["E", "S", "W", "N"];

/**
 * Compare two game states and emit a SaveMovePayload for every discard that
 * appeared in `curr` but not in `prev`.
 *
 * Works for both single-discard transitions (normal/fast speed) and batch
 * transitions where the whole game completes in one step (ludicrous speed).
 *
 * For batch transitions the hand and wall before each discard are approximated:
 *   handBefore[i]  = finalHand + newDiscards[i..] (tiles discarded at or after this point)
 *   probBefore/After use the final wall (wall counts are lower than at actual discard
 *   time, so absolute probabilities will be scaled down, but relative shape is preserved).
 */
export function detectDiscards(
  prev: GameState,
  curr: GameState,
): Omit<SaveMovePayload, "turn">[] {
  const moves: Omit<SaveMovePayload, "turn">[] = [];

  for (const seat of SEATS) {
    const prevPile = prev.discardPile[seat] ?? [];
    const currPile = curr.discardPile[seat] ?? [];
    if (currPile.length <= prevPile.length) continue;

    const newDiscards = currPile.slice(prevPile.length);  // all tiles added in this transition
    const finalHand   = curr.hands[seat] ?? [];
    const wall        = curr.wall;

    for (let i = 0; i < newDiscards.length; i++) {
      const discardedTile = newDiscards[i];
      // Approximate hand before this discard: final hand + tiles discarded after it
      const handBefore: Tile[] = [...finalHand, ...newDiscards.slice(i)];
      const handAfter:  Tile[] = [...finalHand, ...newDiscards.slice(i + 1)];

      moves.push({
        player: seat,
        action: "discard",
        tileId: discardedTile.id,
        handBefore: handBefore.map(t => t.id),
        winProbBefore: evaluateHand(handBefore, wall).winProbability,
        winProbAfter:  evaluateHand(handAfter,  wall).winProbability,
      });
    }
  }

  return moves;
}
