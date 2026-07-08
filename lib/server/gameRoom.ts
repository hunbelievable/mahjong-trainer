// =============================================================================
// GameRoom — the authoritative, in-memory game runtime for one multiplayer room.
//
// Owns the canonical GameState (via the pure engine reducer, run live), records
// an append-only log of concrete outcomes (Option B — see docs §6), and drives
// CPU seats until the single designated human (`ctx.humanSeat`) must act — a
// Charleston tile choice, a Second-Charleston vote, a discard, a claim/pass, or
// a joker swap. Courtesy pass stays auto-declined (a deliberate simplification —
// rare, optional, and "always decline" is a normal real choice). Multi-human
// coordination (several humans staging Charleston or racing a claim at once) is
// P4, design doc §16, and out of scope here. Clients only ever receive
// `viewFor(seat)` (redacted). Transport (WS/HTTP) and identity (Auth.js) wrap
// this — this module has no I/O.
// =============================================================================

import { createGameState, gameReducer } from "@/engine/gameEngine";
import type { GameState, GameAction, EngineContext } from "@/engine/gameEngine";
import { DIFFICULTY_PRESETS, chooseTilesForCharleston } from "@/engine/cpu";
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
  | { type: "wall_game" };

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

  /** The human seat that must act right now (discard), or null. */
  get waitingOn(): PlayerId | null {
    if (this.state.phase !== "playing") return null;
    if (this.state.pendingAction?.type !== "human_discard") return null;
    const seat = this.state.currentSeat;
    return this.ctx.humanSeats.has(seat) ? seat : null;
  }

  /**
   * The human seat that must respond to an open claim window, or null. Claim
   * eligibility is computed engine-side only for `ctx.humanSeat` (the single
   * designated human — see openClaimWindow in gameEngine.ts), so this only
   * ever resolves for a single-human room. Multi-human claim races are P4
   * (design doc §16) and out of scope here.
   */
  get waitingOnClaim(): PlayerId | null {
    if (this.state.phase !== "playing") return null;
    if (this.state.pendingAction?.type !== "claim_window") return null;
    return this.ctx.humanSeats.has(this.ctx.humanSeat) ? this.ctx.humanSeat : null;
  }

  /**
   * The human seat that must act on a Charleston step (staging 3 tiles, or
   * voting whether to play the Second Charleston), or null. Same single-human
   * scope as claims — `ctx.humanSeat` is the only seat the engine will ever
   * pause on here; a second human's Charleston is still CPU-driven until the
   * P4 multi-seat staging barrier exists.
   */
  get waitingOnCharleston(): PlayerId | null {
    if (this.state.phase !== "charleston") return null;
    const t = this.state.pendingAction?.type;
    if (t !== "human_charleston_pass" && t !== "human_charleston_stop") return null;
    return this.ctx.humanSeats.has(this.ctx.humanSeat) ? this.ctx.humanSeat : null;
  }

  /** The redacted view for one seat — the ONLY state a client may receive. */
  viewFor(seat: PlayerId): PlayerView {
    return redactStateForSeat(this.state, seat);
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
      if (this.waitingOnClaim !== seat) return false;
      if (!this.apply(action)) return false;
      this.drive();
      return true;
    }

    if (action.type === "HUMAN_STAGE_CHARLESTON") {
      if (this.waitingOnCharleston !== seat) return false;
      if (this.state.pendingAction?.type !== "human_charleston_pass") return false;
      if (!this.apply(action)) return false;
      this.drive();
      return true;
    }

    if (action.type === "STOP_CHARLESTON" || action.type === "BEGIN_SECOND_CHARLESTON") {
      if (this.waitingOnCharleston !== seat) return false;
      if (this.state.pendingAction?.type !== "human_charleston_stop") return false;
      if (!this.apply(action)) return false;
      this.drive();
      return true;
    }

    return false; // courtesy pass + lobby actions stay server-driven / out of WS scope
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
   * Advance the game until the human must act or it finishes: auto-plays
   * Charleston/courtesy for CPU seats (pausing for the human's real choice),
   * runs CPU turns, and pauses on any claim window the human is eligible for.
   */
  private drive(): void {
    let guard = 5000;
    while (guard-- > 0) {
      if (this.state.phase === "finished") return;
      const pa = this.state.pendingAction;

      if (this.state.phase === "charleston") {
        const humanIsReal = this.ctx.humanSeats.has(this.ctx.humanSeat);

        if (pa?.type === "human_charleston_pass") {
          if (humanIsReal) return; // wait for the human's real tile choice — see submit()
          const seat = this.ctx.humanSeat;
          const strategy = this.ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
          const tiles = chooseTilesForCharleston(
            strategy, this.state.hands[seat], this.state.wall, this.ctx.patterns,
          );
          if (!this.apply({ type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles.map((t) => t.id) })) return;
        } else if (pa?.type === "human_charleston_stop") {
          if (humanIsReal) return; // wait for the human's real Play/Skip vote — see submit()
          if (!this.apply({ type: "STOP_CHARLESTON" })) return; // no human here — skip Second Charleston
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
        if (this.ctx.humanSeats.has(this.ctx.humanSeat)) {
          return; // a human is eligible to claim — wait for submit()
        }
        if (!this.apply({ type: "HUMAN_PASS" })) return; // no human eligible here — CPUs auto-resolve
      } else if (pa.type === "human_discard") {
        return; // a human must act — wait for submit()
      } else {
        return;
      }
    }
  }
}
