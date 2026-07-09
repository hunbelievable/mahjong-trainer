// =============================================================================
// GameRoom — the authoritative, in-memory game runtime for one multiplayer room.
//
// Owns the canonical GameState (via the pure engine reducer, run live), records
// an append-only log of concrete outcomes (Option B — see docs §6), and drives
// CPU seats while every real human seat acts for itself — Charleston staging
// (a barrier: every human seat must stage before a step executes), the
// Second-Charleston vote, discards, claim windows (a bounded race with
// priority + tie-break resolution), and joker swaps. Courtesy pass stays
// single-human/auto-declined (a deliberate simplification — rare, optional,
// and "always decline" is a normal real choice). Clients only ever receive
// `viewFor(seat)` (redacted). Transport (WS/HTTP) and identity wrap this —
// this module has no I/O.
// =============================================================================

import { createGameState, gameReducer } from "@/engine/gameEngine";
import type { GameState, GameAction, EngineContext } from "@/engine/gameEngine";
import { DIFFICULTY_PRESETS } from "@/engine/cpu";
import type { DifficultyLevel, SeatStrategies } from "@/engine/cpu";
import { PATTERNS } from "@/engine/patterns";
import type { PlayerId } from "@/engine/tiles";
import { SEAT_ORDER } from "@/engine/tiles";
import { redactStateForSeat, type PlayerView } from "./redact";

export type SeatConfig =
  | { kind: "human"; userId: string }
  | { kind: "cpu"; difficulty: DifficultyLevel };

/** A concrete, resolved effect recorded in the append-only log. */
export type RoomEffect =
  | { type: "init" }
  | { type: "discard"; seat: PlayerId; tileId: string }
  | { type: "claim"; seat: PlayerId; claimType: string; tileIds: string[] }
  | { type: "win"; seat: PlayerId }
  | { type: "wall_game" }
  | { type: "seat_cpu_takeover"; seat: PlayerId };

export type RoomEvent = RoomEffect & { seq: number; at: number };

/** Diff two states into concrete effects (discards, claims, game end). */
function diffEffects(prev: GameState, curr: GameState): RoomEffect[] {
  const out: RoomEffect[] = [];
  for (const seat of SEAT_ORDER) {
    const p = prev.discardPile[seat]?.length ?? 0;
    const c = curr.discardPile[seat]?.length ?? 0;
    for (let i = p; i < c; i++) {
      out.push({ type: "discard", seat, tileId: curr.discardPile[seat][i].id });
    }
    const pm = prev.melds[seat]?.length ?? 0;
    const cm = curr.melds[seat]?.length ?? 0;
    for (let i = pm; i < cm; i++) {
      const m = curr.melds[seat][i];
      out.push({ type: "claim", seat, claimType: m.type, tileIds: m.tiles.map((t) => t.id) });
    }
  }
  if (!prev.winner && curr.winner) out.push({ type: "win", seat: curr.winner });
  else if (prev.phase !== "finished" && curr.phase === "finished" && !curr.winner) {
    out.push({ type: "wall_game" });
  }
  return out;
}

export class GameRoom {
  readonly seats: Record<PlayerId, SeatConfig>;
  private ctx: EngineContext;
  private state: GameState;
  private _events: RoomEvent[] = [];
  private _seq = 0;

  constructor(seats: Record<PlayerId, SeatConfig>) {
    this.seats = seats;

    const humanSeats = new Set(SEAT_ORDER.filter((s) => seats[s].kind === "human"));
    const strategies = {} as SeatStrategies;
    for (const s of SEAT_ORDER) {
      const cfg = seats[s];
      strategies[s] = DIFFICULTY_PRESETS[cfg.kind === "cpu" ? cfg.difficulty : "intermediate"];
    }
    // A single designated human drives the still-single-human Charleston/claim
    // paths; falls back to "E" for an all-CPU room.
    const humanSeat: PlayerId = Array.from(humanSeats)[0] ?? "E";

    this.ctx = { humanSeat, humanSeats, strategies, patterns: PATTERNS };
    this.state = createGameState();
  }

  // ── Read accessors (never expose raw hands/wall to callers) ────────────────
  get phase(): GameState["phase"] { return this.state.phase; }
  get currentSeat(): PlayerId { return this.state.currentSeat; }
  get winner(): PlayerId | null { return this.state.winner; }
  get events(): readonly RoomEvent[] { return this._events; }

  /** The finished game's outcome (wind-labeled), or null while still in progress. Used by RoomManager for match scoring. */
  get result(): {
    winner: PlayerId | null;
    winningPattern: GameState["winningPattern"];
    winKind: GameState["winKind"];
    winDiscardedBy: PlayerId | null;
  } | null {
    if (this.state.phase !== "finished") return null;
    return {
      winner: this.state.winner,
      winningPattern: this.state.winningPattern,
      winKind: this.state.winKind,
      winDiscardedBy: this.state.winDiscardedBy,
    };
  }

  /** The human seat that must act right now (discard), or null. */
  get waitingOn(): PlayerId | null {
    if (this.state.phase !== "playing") return null;
    if (this.state.pendingAction?.type !== "human_discard") return null;
    const seat = this.state.currentSeat;
    return this.ctx.humanSeats.has(seat) ? seat : null;
  }

  /** Every human seat still eligible to respond to an open claim window (empty if none/not open). */
  get waitingOnClaim(): PlayerId[] {
    if (this.state.phase !== "playing") return [];
    const pa = this.state.pendingAction;
    if (pa?.type !== "claim_window") return [];
    return SEAT_ORDER.filter((s) => pa.eligibleSeats[s] !== undefined && pa.responses[s] === undefined);
  }

  /** Every human seat still needing to stage tiles or vote for the current Charleston step (empty if none/not open). */
  get waitingOnCharleston(): PlayerId[] {
    if (this.state.phase !== "charleston") return [];
    const pa = this.state.pendingAction;
    if (pa?.type === "human_charleston_pass") {
      return SEAT_ORDER.filter((s) => this.ctx.humanSeats.has(s) && !this.state.charleston?.staged[s]);
    }
    if (pa?.type === "human_charleston_stop") {
      return SEAT_ORDER.filter((s) => this.ctx.humanSeats.has(s) && pa.votes[s] === undefined);
    }
    return [];
  }

  /** The redacted view for one seat — the ONLY state a client may receive. */
  viewFor(seat: PlayerId): PlayerView {
    return {
      ...redactStateForSeat(this.state, seat),
      // Safe to attach unfiltered — these getters already only ever name real
      // human seats (waitingOnCharleston) or reduce to a bare count
      // (waitingOnClaim.length), never another seat's claim eligibility.
      charlestonWaitingOn: this.waitingOnCharleston,
      claimPendingCount: this.waitingOnClaim.length,
    };
  }

  /** Full authoritative state — server-side resume/snapshot only, never sent to a client. */
  snapshot(): GameState {
    return this.state;
  }

  // ── Command handling ───────────────────────────────────────────────────────

  /** Deal and drive to the first point a human must act (or completion). */
  start(): void {
    if (this.apply({ type: "START_GAME" })) {
      this._events.push({ seq: this._seq++, at: Date.now(), type: "init" });
    }
    this.drive();
  }

  /**
   * A human seat submits a play action. Returns false if the move isn't legal
   * for that seat right now (wrong seat, not their turn, no such window open).
   * The acting seat is stamped onto the action itself (never trusted from the
   * action object) so the reducer can address barriers/races to the right seat.
   */
  submit(seat: PlayerId, action: GameAction): boolean {
    if (!this.ctx.humanSeats.has(seat)) return false;

    if (action.type === "HUMAN_DISCARD" || action.type === "HUMAN_JOKER_SWAP") {
      // Joker swaps are only legal on your own turn, same as a discard —
      // matches the reducer's own guard (pendingAction must be human_discard).
      if (this.waitingOn !== seat) return false;
      if (!this.apply(action)) return false;
      this.drive();
      return true;
    }

    if (action.type === "HUMAN_CLAIM" || action.type === "HUMAN_PASS") {
      if (!this.waitingOnClaim.includes(seat)) return false;
      if (!this.apply({ ...action, seat })) return false;
      this.drive();
      return true;
    }

    if (action.type === "HUMAN_STAGE_CHARLESTON") {
      if (this.state.pendingAction?.type !== "human_charleston_pass") return false;
      if (!this.waitingOnCharleston.includes(seat)) return false;
      if (!this.apply({ ...action, seat })) return false;
      this.drive();
      return true;
    }

    if (action.type === "STOP_CHARLESTON" || action.type === "BEGIN_SECOND_CHARLESTON") {
      if (this.state.pendingAction?.type !== "human_charleston_stop") return false;
      if (!this.waitingOnCharleston.includes(seat)) return false;
      if (!this.apply({ ...action, seat })) return false;
      this.drive();
      return true;
    }

    return false; // courtesy pass + lobby actions stay server-driven / out of WS scope
  }

  /**
   * Convert a real human seat to CPU control for the rest of this game
   * (kicked by the room's creator, or self-forfeited) — synthesizes a CPU
   * decision for whatever that seat currently owed the game (see
   * CONVERT_TO_CPU in the engine), so the room is never left stalled waiting
   * on someone who can no longer submit(). Returns false if the seat is
   * already CPU or the game isn't running.
   */
  convertSeatToCpu(seat: PlayerId, difficulty: DifficultyLevel = "intermediate"): boolean {
    if (!this.ctx.humanSeats.has(seat)) return false;
    if (this.state.phase !== "charleston" && this.state.phase !== "playing") return false;

    this.ctx.humanSeats.delete(seat);
    this.ctx.strategies[seat] = DIFFICULTY_PRESETS[difficulty];
    // ctx.humanSeat is the single-seat fallback used by courtesy pass and the
    // all-CPU Charleston/vote synthesis path — must never point at a seat
    // that's no longer human.
    if (this.ctx.humanSeat === seat) {
      this.ctx.humanSeat = Array.from(this.ctx.humanSeats)[0] ?? "E";
    }

    this._events.push({ seq: this._seq++, at: Date.now(), type: "seat_cpu_takeover", seat });
    this.apply({ type: "CONVERT_TO_CPU", seat });
    this.drive();
    return true;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private apply(action: GameAction): boolean {
    const prev = this.state;
    const next = gameReducer(prev, action, this.ctx);
    if (next === prev) return false; // reducer rejected (illegal) — no state change
    this.state = next;
    for (const effect of diffEffects(prev, next)) {
      this._events.push({ seq: this._seq++, at: Date.now(), ...effect });
    }
    return true;
  }

  /**
   * Advance the game until a real human must act or it finishes. The reducer
   * itself already resolves Charleston steps/votes and claim windows the
   * instant nobody real is left to wait on (including the all-CPU-room case,
   * synchronously within apply() below) — so this loop's job is just courtesy
   * pass (still single-human/auto-declined) and CPU turns, pausing whenever a
   * pendingAction still names a real human.
   */
  private drive(): void {
    let guard = 5000;
    while (guard-- > 0) {
      if (this.state.phase === "finished") return;
      const pa = this.state.pendingAction;

      if (this.state.phase === "charleston") {
        if (pa?.type === "human_charleston_pass" || pa?.type === "human_charleston_stop") {
          return; // a real human still needs to stage or vote — see submit()
        } else if (pa?.type === "human_courtesy_propose") {
          if (!this.apply({ type: "HUMAN_COURTESY_RESPOND", count: 0 })) return;
        } else if (pa?.type === "human_courtesy_select") {
          const seat = this.ctx.humanSeat;
          const ids = this.state.hands[seat]
            .filter((t) => t.suit !== "joker").slice(0, pa.count).map((t) => t.id);
          if (!this.apply({ type: "HUMAN_COURTESY_PASS", tileIds: ids })) return;
        } else return;
        continue;
      }

      // playing
      if (pa === null) {
        if (!this.apply({ type: "ADVANCE_CPU" })) return;
      } else if (pa.type === "claim_window") {
        return; // a real human is still eligible to respond — see submit()
      } else if (pa.type === "human_discard") {
        return; // a human must act — wait for submit()
      } else {
        return;
      }
    }
  }
}
