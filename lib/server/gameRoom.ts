// =============================================================================
// GameRoom — the authoritative, in-memory game runtime for one multiplayer room.
//
// Owns the canonical GameState (via the pure engine reducer, run live), records
// an append-only log of concrete outcomes (Option B — see docs §6), auto-plays
// the MVP flows the design defers (Charleston for all seats; human claims
// auto-pass), and drives CPU seats until a human must act. Clients only ever
// receive `viewFor(seat)` (redacted). Transport (WS/SSE) and identity (Auth.js)
// wrap this later — this module has no I/O.
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
   * A human seat submits a play action (MVP: a discard). Returns false if the
   * move isn't legal for that seat right now (wrong seat, not their turn, etc.).
   */
  submit(seat: PlayerId, action: GameAction): boolean {
    if (!this.ctx.humanSeats.has(seat)) return false;
    if (this.waitingOn !== seat) return false;
    if (action.type !== "HUMAN_DISCARD") return false; // MVP surface: discard only
    if (!this.apply(action)) return false;
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
   * Advance the game until a human must discard or it finishes:
   * auto-plays Charleston/courtesy for all seats, runs CPU turns, and (MVP)
   * auto-passes any human claim window.
   */
  private drive(): void {
    let guard = 5000;
    while (guard-- > 0) {
      if (this.state.phase === "finished") return;
      const pa = this.state.pendingAction;

      if (this.state.phase === "charleston") {
        if (pa?.type === "human_charleston_pass") {
          const seat = this.ctx.humanSeat;
          const strategy = this.ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
          const tiles = chooseTilesForCharleston(
            strategy, this.state.hands[seat], this.state.wall, this.ctx.patterns,
          );
          if (!this.apply({ type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles.map((t) => t.id) })) return;
        } else if (pa?.type === "human_charleston_stop") {
          if (!this.apply({ type: "STOP_CHARLESTON" })) return; // skip Second Charleston (MVP)
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
        if (!this.apply({ type: "HUMAN_PASS" })) return; // MVP: humans auto-pass claims
      } else if (pa.type === "human_discard") {
        return; // a human must act — wait for submit()
      } else {
        return;
      }
    }
  }
}
