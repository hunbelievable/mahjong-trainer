// =============================================================================
// RoomManager — in-memory registry of rooms and their lobbies.
//
// A room lives in one of three phases: "lobby" (players claim seats, unfilled
// seats will be CPUs), "playing", or "finished". Seat ownership is by userId;
// starting fills every open seat with a CPU and hands off to a GameRoom (the
// authoritative runtime). This module is pure/in-memory — persistence (NATS /
// Postgres) and transport (WS) wrap it later. See docs/multiplayer-design.md §9.
// =============================================================================

import type { PlayerId } from "@/engine/tiles";
import { SEAT_ORDER } from "@/engine/tiles";
import type { DifficultyLevel } from "@/engine/cpu";
import type { GameAction } from "@/engine/gameEngine";
import { GameRoom, type SeatConfig, type RoomEvent } from "./gameRoom";
import type { PlayerView } from "./redact";
import { NoopEventLog, type EventLog } from "./eventLog";

export type SeatState =
  | { kind: "open" }
  | { kind: "human"; userId: string }
  | { kind: "cpu"; difficulty: DifficultyLevel };

export type RoomStatus = "lobby" | "playing" | "finished";

export interface Room {
  id: string;
  seats: Record<PlayerId, SeatState>;
  /** The authoritative runtime once the game has started; null while in the lobby. */
  game: GameRoom | null;
  createdAt: number;
}

/** What a client is shown about the lobby (never another user's identity beyond "taken"). */
export interface LobbyView {
  roomId: string;
  status: RoomStatus;
  yourSeat: PlayerId | null;
  seats: Array<{ seat: PlayerId; kind: SeatState["kind"]; isYou: boolean; difficulty?: DifficultyLevel }>;
}

const DEFAULT_CPU_DIFFICULTY: DifficultyLevel = "intermediate";

function openSeats(): Record<PlayerId, SeatState> {
  return { E: { kind: "open" }, S: { kind: "open" }, W: { kind: "open" }, N: { kind: "open" } };
}

function makeRoomId(exists: (id: string) => boolean): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let id = "";
  do {
    id = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (exists(id));
  return id;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  /** How many of each room's GameRoom.events have already been sent to the event log. */
  private persistedCounts = new Map<string, number>();

  constructor(private eventLog: EventLog = new NoopEventLog()) {}

  /** Swap in a real (e.g. NATS-backed) event log once it's connected. See server.ts boot sequence. */
  setEventLog(log: EventLog): void {
    this.eventLog = log;
  }

  /** Every persisted event for a room, in order — for diagnostics or a future resume feature. */
  persistedEvents(id: string): Promise<RoomEvent[]> {
    return this.eventLog.readAll(id);
  }

  private persistNewEvents(id: string, game: GameRoom): void {
    const already = this.persistedCounts.get(id) ?? 0;
    const events = game.events;
    for (let i = already; i < events.length; i++) {
      const event = events[i];
      void this.eventLog.append(id, event).catch((err) => {
        console.error(`[RoomManager] failed to persist event for room ${id}:`, err);
      });
    }
    this.persistedCounts.set(id, events.length);
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────

  createRoom(): Room {
    const id = makeRoomId((x) => this.rooms.has(x));
    const room: Room = { id, seats: openSeats(), game: null, createdAt: Date.now() };
    this.rooms.set(id, room);
    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  statusOf(room: Room): RoomStatus {
    if (!room.game) return "lobby";
    return room.game.phase === "finished" ? "finished" : "playing";
  }

  /** The seat a user holds in a room, or null. */
  seatOf(room: Room, userId: string): PlayerId | null {
    return SEAT_ORDER.find((s) => {
      const st = room.seats[s];
      return st.kind === "human" && st.userId === userId;
    }) ?? null;
  }

  /** Claim an open seat. Fails if the room has started, the seat is taken, or the user already sits. */
  claimSeat(id: string, seat: PlayerId, userId: string): boolean {
    const room = this.rooms.get(id);
    if (!room || this.statusOf(room) !== "lobby") return false;
    if (room.seats[seat].kind !== "open") return false;
    if (this.seatOf(room, userId) !== null) return false; // one seat per user
    room.seats[seat] = { kind: "human", userId };
    return true;
  }

  /** Release the seat a user holds (returns it to open). */
  releaseSeat(id: string, userId: string): boolean {
    const room = this.rooms.get(id);
    if (!room || this.statusOf(room) !== "lobby") return false;
    const seat = this.seatOf(room, userId);
    if (!seat) return false;
    room.seats[seat] = { kind: "open" };
    return true;
  }

  /** Set an open/CPU seat to a CPU of the given difficulty (lobby only, not a human seat). */
  setSeatCpu(id: string, seat: PlayerId, difficulty: DifficultyLevel): boolean {
    const room = this.rooms.get(id);
    if (!room || this.statusOf(room) !== "lobby") return false;
    if (room.seats[seat].kind === "human") return false;
    room.seats[seat] = { kind: "cpu", difficulty };
    return true;
  }

  /** Fill every open seat with a CPU and start the game. Fails if not in the lobby. */
  start(id: string): boolean {
    const room = this.rooms.get(id);
    if (!room || this.statusOf(room) !== "lobby") return false;

    const config = {} as Record<PlayerId, SeatConfig>;
    for (const s of SEAT_ORDER) {
      const st = room.seats[s];
      if (st.kind === "human") config[s] = { kind: "human", userId: st.userId };
      else if (st.kind === "cpu") config[s] = { kind: "cpu", difficulty: st.difficulty };
      else config[s] = { kind: "cpu", difficulty: DEFAULT_CPU_DIFFICULTY }; // open → CPU
    }

    room.game = new GameRoom(config);
    room.game.start();
    this.persistNewEvents(id, room.game);
    return true;
  }

  // ── In-game ────────────────────────────────────────────────────────────────

  /** A user submits a play action. Authorizes seat ownership, then delegates to the GameRoom. */
  submit(id: string, userId: string, action: GameAction): boolean {
    const room = this.rooms.get(id);
    if (!room || !room.game) return false;
    const seat = this.seatOf(room, userId);
    if (!seat) return false;
    const ok = room.game.submit(seat, action);
    if (ok) this.persistNewEvents(id, room.game);
    return ok;
  }

  /** The redacted play view for a user, or null if they don't hold a seat / game not started. */
  viewFor(id: string, userId: string): PlayerView | null {
    const room = this.rooms.get(id);
    if (!room || !room.game) return null;
    const seat = this.seatOf(room, userId);
    if (!seat) return null;
    return room.game.viewFor(seat);
  }

  /** The lobby view for a user (safe to send: seat kinds + which one is theirs). */
  lobbyView(id: string, userId: string): LobbyView | null {
    const room = this.rooms.get(id);
    if (!room) return null;
    const yourSeat = this.seatOf(room, userId);
    return {
      roomId: id,
      status: this.statusOf(room),
      yourSeat,
      seats: SEAT_ORDER.map((seat) => {
        const st = room.seats[seat];
        return {
          seat,
          kind: st.kind,
          isYou: st.kind === "human" && st.userId === userId,
          ...(st.kind === "cpu" ? { difficulty: st.difficulty } : {}),
        };
      }),
    };
  }
}

/** Process-wide singleton used by the API/gateway layer. */
export const roomManager = new RoomManager();
