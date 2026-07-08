// =============================================================================
// Per-seat state redaction — the single chokepoint between the authoritative
// GameState and what a client is allowed to see.
//
// SECURITY: the full GameState holds every player's concealed hand and the wall
// contents. A client must NEVER receive those. `redactStateForSeat` produces a
// `PlayerView` that exposes the viewer's own hand fully, opponents only as tile
// COUNTS plus their public (exposed) melds and discards, and the wall only as a
// count. This is the only function permitted to serialize game state toward a
// client. See docs/multiplayer-design.md §8 and §17.
// =============================================================================

import { findJokerSwaps, type GameState, type Meld, type PendingAction, type GamePhase, type JokerSwap } from "@/engine/gameEngine";
import type { HandPattern } from "@/engine/patterns";
import type { Tile, PlayerId } from "@/engine/tiles";
import { SEAT_ORDER } from "@/engine/tiles";

/** What one seat is allowed to know about another seat. Counts + public tiles only. */
export interface OpponentView {
  seat: PlayerId;
  /** Number of concealed tiles held — never the tiles themselves. */
  handCount: number;
  /** Exposed melds are face-up on the table, so they are public. */
  melds: Meld[];
}

/** Everything a single seat may see. Safe to serialize and send to that client. */
export interface PlayerView {
  you: PlayerId;
  phase: GamePhase;
  currentSeat: PlayerId;

  /** The viewer's own concealed hand — full detail. */
  yourHand: Tile[];
  /** The viewer's own exposed melds. */
  yourMelds: Meld[];
  /**
   * Joker swaps available to the viewer right now. Every tile referenced is
   * either from the viewer's own hand or an exposed (public) meld — safe to
   * include as-is, no redaction needed on this field.
   */
  yourJokerSwaps: JokerSwap[];

  /** The other three seats, in seat order — counts + public melds only. */
  opponents: OpponentView[];

  /** Discards are public for every seat. */
  discardPile: Record<PlayerId, Tile[]>;
  /** Tiles left to draw — a count only, never the wall contents. */
  wallCount: number;

  /** The most recent discard (public), or null. */
  lastDiscard: Tile | null;
  /** Who drew most recently (public — you can see a draw happen). */
  lastDrawSeat: PlayerId | null;
  /** The viewer's own just-drawn tile id (for the "just drawn" highlight); null for others' draws. */
  yourFreshTileId: string | null;

  /** The pending action only if it is this seat's to act on; otherwise null. */
  pendingActionForYou: PendingAction;

  turnNumber: number;
  winner: PlayerId | null;
  /** Public once the game is finished. Contains no tile identities. */
  winningPattern: HandPattern | null;
  /** Human-readable event log. Must remain public-safe (no concealed tiles). */
  log: string[];
}

/**
 * Decide whether the current pending action belongs to `seat`.
 * - human_discard → the seat whose turn it is (currentSeat)
 * - claim_window  → any seat that could claim (i.e. not the discarder)
 * - charleston / courtesy → single-human flows; MVP multiplayer auto-plays them
 *   server-side, so they carry no concealed tiles and are passed through.
 */
function pendingActionForSeat(state: GameState, seat: PlayerId): PendingAction {
  const pa = state.pendingAction;
  if (!pa) return null;
  switch (pa.type) {
    case "human_discard":
      return seat === state.currentSeat ? pa : null;
    case "claim_window":
      return seat !== pa.discardedBy ? pa : null;
    default:
      return pa;
  }
}

/**
 * Produce the redacted view for `you`. Pure — does not mutate `state`.
 */
export function redactStateForSeat(state: GameState, you: PlayerId): PlayerView {
  const opponents: OpponentView[] = SEAT_ORDER
    .filter((s) => s !== you)
    .map((s) => ({
      seat: s,
      handCount: state.hands[s]?.length ?? 0,
      melds: state.melds[s] ?? [],
    }));

  return {
    you,
    phase: state.phase,
    currentSeat: state.currentSeat,
    yourHand: state.hands[you] ?? [],
    yourMelds: state.melds[you] ?? [],
    yourJokerSwaps: findJokerSwaps(state, you),
    opponents,
    discardPile: state.discardPile,
    wallCount: state.wall.length,
    lastDiscard: state.lastDiscard,
    lastDrawSeat: state.lastDraw?.seat ?? null,
    yourFreshTileId:
      state.lastDraw && state.lastDraw.seat === you ? state.lastDraw.tileId : null,
    pendingActionForYou: pendingActionForSeat(state, you),
    turnNumber: state.turnNumber,
    winner: state.winner,
    winningPattern: state.winningPattern,
    log: state.log,
  };
}

/**
 * Collect every concrete tile id present anywhere in a PlayerView. Used by tests
 * to prove that no concealed opponent tile or wall tile ever leaks into a view.
 */
export function tileIdsInView(view: PlayerView): Set<string> {
  const ids = new Set<string>();
  const add = (tiles: Tile[]) => tiles.forEach((t) => ids.add(t.id));
  add(view.yourHand);
  view.yourMelds.forEach((m) => add(m.tiles));
  view.opponents.forEach((o) => o.melds.forEach((m) => add(m.tiles)));
  Object.values(view.discardPile).forEach(add);
  if (view.lastDiscard) ids.add(view.lastDiscard.id);
  return ids;
}
