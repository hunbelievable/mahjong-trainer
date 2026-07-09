// =============================================================================
// Pure rotation/scoring logic for a multiplayer Match (a series of games in one
// Room). The engine only ever plays East-first with labels E/S/W/N; a Match
// re-maps the four FIXED PHYSICAL seats (who's sitting where, unchanging for
// the whole match) onto those wind labels per game. Physical seats and wind
// labels share the same PlayerId alphabet but mean different things — a
// WindAssignment is the only bridge between them. See docs/multiplayer-design.md §18.
// =============================================================================

import type { PlayerId } from "@/engine/tiles";
import { SEAT_ORDER } from "@/engine/tiles";
import type { DifficultyLevel } from "@/engine/cpu";

export type WinKind = "discard" | "self_draw" | "wall";

/** physical seat → wind label for one game. */
export type WindAssignment = Record<PlayerId, PlayerId>;

/** One completed game's result, keyed by physical seat — the Match standings history entry. */
export interface MatchGameSummary {
  gameNumber: number;
  dealerSeat: PlayerId;
  winnerSeat: PlayerId | null;
  winKind: WinKind;
  patternName: string | null;
  patternValue: number | null;
  payouts: Record<PlayerId, number>;
}

/** Match standings — safe to send to any client (no raw userId, only isYou). */
export interface MatchView {
  matchId: string;
  gameNumber: number;
  dealerSeat: PlayerId;
  canStartNextGame: boolean;
  /** Whether the requesting user created this room — gates the Kick control. */
  isRoomCreator: boolean;
  players: Array<{
    seat: PlayerId;
    kind: "human" | "cpu";
    isYou: boolean;
    difficulty?: DifficultyLevel;
    score: number;
  }>;
  history: MatchGameSummary[];
}

/** Dealer (physical seat) always plays East; the rest follow turn order (E→S→W→N). */
export function computeWindAssignment(dealerPhysical: PlayerId): WindAssignment {
  const winds: PlayerId[] = ["E", "S", "W", "N"];
  const startIdx = SEAT_ORDER.indexOf(dealerPhysical);
  const assignment = {} as WindAssignment;
  for (let i = 0; i < 4; i++) {
    assignment[SEAT_ORDER[(startIdx + i) % 4]] = winds[i];
  }
  return assignment;
}

/** wind label → physical seat — the inverse of a WindAssignment. */
export function invertWindAssignment(assignment: WindAssignment): Record<PlayerId, PlayerId> {
  const inverted = {} as Record<PlayerId, PlayerId>;
  for (const physical of SEAT_ORDER) {
    inverted[assignment[physical]] = physical;
  }
  return inverted;
}

/**
 * NMJL rotation: East keeps the deal on an East win or a wall game; otherwise
 * the deal passes to the next physical seat in turn order.
 */
export function nextDealer(
  currentDealerPhysical: PlayerId,
  winnerPhysical: PlayerId | null,
  kind: WinKind,
): PlayerId {
  if (kind === "wall" || winnerPhysical === currentDealerPhysical) return currentDealerPhysical;
  const idx = SEAT_ORDER.indexOf(currentDealerPhysical);
  return SEAT_ORDER[(idx + 1) % 4];
}

/**
 * NMJL scoring: win on discard → discarder pays 2×, other two pay 1× each
 * (winner +4×); self-draw → all three opponents pay 2× each (winner +6×);
 * wall → no payment. Zero-sum by construction.
 */
export function computePayouts(
  kind: WinKind,
  winnerPhysical: PlayerId | null,
  discarderPhysical: PlayerId | null,
  value: number,
): Record<PlayerId, number> {
  const payouts: Record<PlayerId, number> = { E: 0, S: 0, W: 0, N: 0 };
  if (kind === "wall" || !winnerPhysical) return payouts;

  const others = SEAT_ORDER.filter((s) => s !== winnerPhysical);
  if (kind === "self_draw") {
    for (const s of others) payouts[s] = -2 * value;
    payouts[winnerPhysical] = 6 * value;
  } else {
    for (const s of others) payouts[s] = s === discarderPhysical ? -2 * value : -1 * value;
    payouts[winnerPhysical] = 4 * value;
  }
  return payouts;
}
