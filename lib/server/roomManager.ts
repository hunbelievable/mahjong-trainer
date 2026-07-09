// =============================================================================
// RoomManager — in-memory registry of rooms and their lobbies.
//
// A room lives in one of three phases: "lobby" (players claim seats, unfilled
// seats will be CPUs), "playing", or "finished". Seat ownership is by userId;
// starting fills every open seat with a CPU and hands off to a GameRoom (the
// authoritative runtime). This module is pure/in-memory — persistence (NATS /
// Postgres) and transport (WS) wrap it later. See docs/multiplayer-design.md §9.
//
// Physical seat vs wind label: once a match starts, `room.seats`/`match.players`
// track the four FIXED PHYSICAL seats (who's actually sitting where, for the
// whole match); GameRoom only ever knows wind labels E/S/W/N (always East-first).
// `match.windAssignment` is the per-game bridge between them — see lib/server/match.ts.
//
// Handles: a human seat carries the claimer's display handle (captured once,
// at claim/match-start time — later profile edits don't retroactively update
// an already-seated display, matching this app's existing "sticky at the
// moment of action" tradeoffs elsewhere). `room.seats`/`match.players` store
// it physical-seat-keyed; `RoomManager.viewFor` additionally projects a
// wind-keyed map onto PlayerView, since the live game only ever speaks wind
// labels (see `PlayerView.handles`).
// =============================================================================

import type { PlayerId } from "@/engine/tiles";
import { SEAT_ORDER } from "@/engine/tiles";
import type { DifficultyLevel } from "@/engine/cpu";
import type { GameAction } from "@/engine/gameEngine";
import { GameRoom, type SeatConfig, type RoomEvent } from "./gameRoom";
import type { PlayerView } from "./redact";
import { NoopEventLog, type EventLog } from "./eventLog";
import {
  computeWindAssignment,
  invertWindAssignment,
  nextDealer,
  computePayouts,
  type WindAssignment,
  type WinKind,
  type MatchGameSummary,
  type MatchView,
} from "./match";
import { persistMatchCreate, persistMatchGame, persistMatchPlayerScores, persistMatchEnd } from "./matchStore";

export type SeatState =
  | { kind: "open" }
  | { kind: "human"; userId: string; handle: string | null }
  | { kind: "cpu"; difficulty: DifficultyLevel };

export type RoomStatus = "lobby" | "playing" | "finished" | "closed";

/** A physical seat's fixed occupancy for the whole match. */
interface MatchPlayer {
  userId: string | null;
  isCpu: boolean;
  cpuDifficulty: DifficultyLevel | null;
  handle: string | null;
  score: number;
}

interface MatchState {
  id: string;
  dealerSeat: PlayerId; // physical seat — dealer for the current (or, once finished, upcoming) game
  windAssignment: WindAssignment; // physical -> wind, for the current game
  gameNumber: number;
  /** The last game number whose result was folded into players/history — recording is idempotent per game. */
  recordedGameNumber: number;
  players: Record<PlayerId, MatchPlayer>;
  history: MatchGameSummary[];
}

/** An in-room chat message, attributed by physical seat (no handles — see docs). Never persisted. */
export interface ChatMessage {
  seat: PlayerId;
  text: string;
  at: number;
}

const CHAT_HISTORY_LIMIT = 50;
const CHAT_MAX_LENGTH = 500;

export interface Room {
  id: string;
  seats: Record<PlayerId, SeatState>;
  /** The authoritative runtime once the game has started; null while in the lobby. */
  game: GameRoom | null;
  /** The running match (series of games) once started; null while in the lobby. */
  match: MatchState | null;
  createdAt: number;
  /** Whoever created the room — the only user allowed to kick another seat or close the room. Null for rooms created before this existed. */
  createdByUserId: string | null;
  /** Set once the creator closes the room — abandons whatever game was in progress and permanently ends it. */
  closedAt: number | null;
  /** Ring buffer of the most recent chat messages — in-memory only, never persisted, gone when the room does. */
  chatLog: ChatMessage[];
}

/** What a client is shown about the lobby (never another user's identity beyond "taken"). */
export interface LobbyView {
  roomId: string;
  status: RoomStatus;
  yourSeat: PlayerId | null;
  /** Whether the requesting user created this room — gates the Kick control. */
  isRoomCreator: boolean;
  seats: Array<{
    seat: PlayerId;
    kind: SeatState["kind"];
    isYou: boolean;
    difficulty?: DifficultyLevel;
    handle?: string;
  }>;
}

/** One row in the "join a room" browser — deliberately no creator identity, just enough to pick a room. */
export interface OpenRoomSummary {
  roomId: string;
  createdAt: number;
  seatsHuman: number;
  seatsOpen: number;
}

const DEFAULT_CPU_DIFFICULTY: DifficultyLevel = "intermediate";
/** A seat vacated mid-match (kicked or forfeited) hands off to an easier CPU than a never-claimed seat — the human who was there presumably wanted a real game, not to hand a strong bot the rest of it. */
const VACATED_SEAT_CPU_DIFFICULTY: DifficultyLevel = "beginner";

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

  createRoom(creatorUserId: string): Room {
    const id = makeRoomId((x) => this.rooms.has(x));
    const room: Room = {
      id,
      seats: openSeats(),
      game: null,
      match: null,
      createdAt: Date.now(),
      createdByUserId: creatorUserId,
      closedAt: null,
      chatLog: [],
    };
    this.rooms.set(id, room);
    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  statusOf(room: Room): RoomStatus {
    if (room.closedAt !== null) return "closed";
    if (!room.game) return "lobby";
    return room.game.phase === "finished" ? "finished" : "playing";
  }

  /**
   * Abandon whatever game is in progress and permanently end the room —
   * creator-only. There's no partial "end this round but keep the room"
   * option: standings/history live on the match, and starting fresh is
   * simpler than resetting one in place (see docs/multiplayer-design.md §18
   * — match length is already open-ended by design, closing is the only exit).
   */
  closeRoom(id: string, userId: string): boolean {
    const room = this.rooms.get(id);
    if (!room || room.closedAt !== null) return false;
    if (room.createdByUserId !== userId) return false;
    room.closedAt = Date.now();
    if (room.match) void persistMatchEnd(room.match.id);
    return true;
  }

  /** The seat a user holds in a room, or null. */
  seatOf(room: Room, userId: string): PlayerId | null {
    return SEAT_ORDER.find((s) => {
      const st = room.seats[s];
      return st.kind === "human" && st.userId === userId;
    }) ?? null;
  }

  /** Claim an open seat. Fails if the room has started, the seat is taken, or the user already sits. */
  claimSeat(id: string, seat: PlayerId, userId: string, handle: string | null = null): boolean {
    const room = this.rooms.get(id);
    if (!room || this.statusOf(room) !== "lobby") return false;
    if (room.seats[seat].kind !== "open") return false;
    if (this.seatOf(room, userId) !== null) return false; // one seat per user
    room.seats[seat] = { kind: "human", userId, handle };
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

  /**
   * Set an open/CPU seat to a CPU of the given difficulty — creator-only
   * (same authorization as start/kickSeat/closeRoom), lobby only, and can't
   * overwrite a human seat.
   */
  setSeatCpu(id: string, requestingUserId: string, seat: PlayerId, difficulty: DifficultyLevel): boolean {
    const room = this.rooms.get(id);
    if (!room || this.statusOf(room) !== "lobby") return false;
    if (room.createdByUserId !== requestingUserId) return false;
    if (room.seats[seat].kind === "human") return false;
    room.seats[seat] = { kind: "cpu", difficulty };
    return true;
  }

  /**
   * Fill every open seat with a CPU, create the match, and start the first
   * game. Creator-only (same authorization as kickSeat/closeRoom) — the room
   * manager decides when the table is ready, not whoever happens to click
   * first. Fails if not in the lobby.
   */
  start(id: string, userId: string): boolean {
    const room = this.rooms.get(id);
    if (!room || this.statusOf(room) !== "lobby") return false;
    if (room.createdByUserId !== userId) return false;

    const dealerSeat: PlayerId = "E";
    const players = {} as Record<PlayerId, MatchPlayer>;
    for (const s of SEAT_ORDER) {
      const st = room.seats[s];
      if (st.kind === "human") players[s] = { userId: st.userId, isCpu: false, cpuDifficulty: null, handle: st.handle, score: 0 };
      else if (st.kind === "cpu") players[s] = { userId: null, isCpu: true, cpuDifficulty: st.difficulty, handle: null, score: 0 };
      else players[s] = { userId: null, isCpu: true, cpuDifficulty: DEFAULT_CPU_DIFFICULTY, handle: null, score: 0 }; // open → CPU
    }

    const matchId = crypto.randomUUID();
    room.match = {
      id: matchId,
      dealerSeat,
      windAssignment: computeWindAssignment(dealerSeat),
      gameNumber: 1,
      recordedGameNumber: 0,
      players,
      history: [],
    };
    void persistMatchCreate(
      matchId,
      id,
      SEAT_ORDER.map((s) => ({ seat: s, ...players[s] })),
    );

    this.beginGame(room);
    return true;
  }

  /** Rotate the deal per NMJL rules and start the next game in an existing match. Any seated player may trigger it. */
  startNextGame(id: string, userId: string): boolean {
    const room = this.rooms.get(id);
    if (!room || room.closedAt !== null || !room.match || !room.game) return false;
    if (room.game.phase !== "finished") return false;
    if (this.seatOf(room, userId) === null) return false;

    const result = room.game.result;
    if (!result) return false;
    const physicalForWind = invertWindAssignment(room.match.windAssignment);
    const kind: WinKind = result.winner === null ? "wall" : result.winKind ?? "discard";
    const winnerPhysical = result.winner ? physicalForWind[result.winner] : null;

    room.match.dealerSeat = nextDealer(room.match.dealerSeat, winnerPhysical, kind);
    room.match.gameNumber += 1;
    room.match.windAssignment = computeWindAssignment(room.match.dealerSeat);

    this.beginGame(room);
    return true;
  }

  /** Build the wind-labeled GameRoom config from the match's fixed physical occupancy and start it. */
  private beginGame(room: Room): void {
    const match = room.match!;
    const physicalForWind = invertWindAssignment(match.windAssignment);
    const config = {} as Record<PlayerId, SeatConfig>;
    for (const wind of SEAT_ORDER) {
      const p = match.players[physicalForWind[wind]];
      config[wind] = p.isCpu
        ? { kind: "cpu", difficulty: p.cpuDifficulty ?? DEFAULT_CPU_DIFFICULTY }
        : { kind: "human", userId: p.userId! };
    }
    room.game = new GameRoom(config);
    room.game.start();
    this.persistNewEvents(room.id, room.game);
    this.maybeRecordGameResult(room);
  }

  /** Fold a just-finished game's result into match standings + history, once, and persist it. */
  private maybeRecordGameResult(room: Room): void {
    const match = room.match;
    const game = room.game;
    if (!match || !game) return;
    if (match.recordedGameNumber === match.gameNumber) return;
    const result = game.result;
    if (!result) return;

    const physicalForWind = invertWindAssignment(match.windAssignment);
    const kind: WinKind = result.winner === null ? "wall" : result.winKind ?? "discard";
    const winnerPhysical = result.winner ? physicalForWind[result.winner] : null;
    const discarderPhysical = result.winDiscardedBy ? physicalForWind[result.winDiscardedBy] : null;
    const value = result.winningPattern?.value ?? 0;
    const payouts = computePayouts(kind, winnerPhysical, discarderPhysical, value);

    for (const s of SEAT_ORDER) match.players[s].score += payouts[s];

    const summary: MatchGameSummary = {
      gameNumber: match.gameNumber,
      dealerSeat: match.dealerSeat,
      winnerSeat: winnerPhysical,
      winKind: kind,
      patternName: result.winningPattern?.name ?? null,
      patternValue: result.winningPattern?.value ?? null,
      payouts,
    };
    match.history.push(summary);
    match.recordedGameNumber = match.gameNumber;

    void persistMatchGame({ matchId: match.id, ...summary });
    const scores = {} as Record<PlayerId, number>;
    for (const s of SEAT_ORDER) scores[s] = match.players[s].score;
    void persistMatchPlayerScores(match.id, scores);
  }

  private matchView(room: Room, userId: string): MatchView | null {
    const match = room.match;
    if (!match) return null;
    return {
      matchId: match.id,
      gameNumber: match.gameNumber,
      dealerSeat: match.dealerSeat,
      canStartNextGame: room.game?.phase === "finished",
      isRoomCreator: room.createdByUserId === userId,
      players: SEAT_ORDER.map((s) => {
        const p = match.players[s];
        return {
          seat: s,
          kind: p.isCpu ? "cpu" : "human",
          isYou: !p.isCpu && p.userId === userId,
          ...(p.isCpu ? { difficulty: p.cpuDifficulty ?? undefined } : {}),
          ...(p.handle ? { handle: p.handle } : {}),
          score: p.score,
        };
      }),
      history: match.history,
    };
  }

  /**
   * Convert a seat to CPU control mid-match: `kickSeat` (room-creator only,
   * targets any currently-human physical seat) or `forfeitSeat` (self-service,
   * always targets the caller's own seat). Both are permanent for the rest of
   * the match — the seat plays as CPU in this game and every subsequent one,
   * matching how "open" seats already become CPU at match start. No
   * resume/reconnect path exists yet; see docs/multiplayer-design.md §16.C.
   */
  kickSeat(id: string, requestingUserId: string, targetSeat: PlayerId): boolean {
    const room = this.rooms.get(id);
    if (!room || room.createdByUserId !== requestingUserId) return false;
    return this.convertToCpu(room, targetSeat);
  }

  forfeitSeat(id: string, userId: string): boolean {
    const room = this.rooms.get(id);
    if (!room) return false;
    const seat = this.seatOf(room, userId);
    if (!seat) return false;
    return this.convertToCpu(room, seat);
  }

  private convertToCpu(room: Room, targetSeat: PlayerId): boolean {
    if (room.closedAt !== null || !room.match || !room.game) return false;
    if (room.seats[targetSeat].kind !== "human") return false;

    const wind = room.match.windAssignment[targetSeat];
    if (!room.game.convertSeatToCpu(wind)) return false;

    const player = room.match.players[targetSeat];
    room.match.players[targetSeat] = {
      ...player,
      isCpu: true,
      cpuDifficulty: VACATED_SEAT_CPU_DIFFICULTY,
      handle: null,
    };
    room.seats[targetSeat] = { kind: "cpu", difficulty: VACATED_SEAT_CPU_DIFFICULTY };

    this.persistNewEvents(room.id, room.game);
    this.maybeRecordGameResult(room);
    return true;
  }

  // ── In-game ────────────────────────────────────────────────────────────────

  /** A user submits a play action. Authorizes seat ownership, then delegates to the GameRoom. */
  submit(id: string, userId: string, action: GameAction): boolean {
    const room = this.rooms.get(id);
    if (!room || room.closedAt !== null || !room.game || !room.match) return false;
    const seat = this.seatOf(room, userId);
    if (!seat) return false;
    const wind = room.match.windAssignment[seat];
    const ok = room.game.submit(wind, action);
    if (ok) {
      this.persistNewEvents(id, room.game);
      this.maybeRecordGameResult(room);
    }
    return ok;
  }

  /** The redacted play view for a user, or null if they don't hold a seat / game not started. */
  viewFor(id: string, userId: string): PlayerView | null {
    const room = this.rooms.get(id);
    if (!room || !room.game || !room.match) return null;
    const seat = this.seatOf(room, userId);
    if (!seat) return null;
    const wind = room.match.windAssignment[seat];
    const view = room.game.viewFor(wind);
    return { ...view, match: this.matchView(room, userId), handles: this.windKeyedHandles(room.match) };
  }

  /** Project each physical seat's handle onto its wind label for the current game — see the header comment. */
  private windKeyedHandles(match: MatchState): Partial<Record<PlayerId, string>> {
    const handles: Partial<Record<PlayerId, string>> = {};
    for (const physical of SEAT_ORDER) {
      const p = match.players[physical];
      if (!p.isCpu && p.handle) handles[match.windAssignment[physical]] = p.handle;
    }
    return handles;
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
      isRoomCreator: room.createdByUserId === userId,
      seats: SEAT_ORDER.map((seat) => {
        const st = room.seats[seat];
        return {
          seat,
          kind: st.kind,
          isYou: st.kind === "human" && st.userId === userId,
          ...(st.kind === "cpu" ? { difficulty: st.difficulty } : {}),
          ...(st.kind === "human" && st.handle ? { handle: st.handle } : {}),
        };
      }),
    };
  }

  /**
   * Rooms a fresh visitor could actually join: still in the lobby (not
   * started/finished/closed) with at least one open seat. Sorted newest
   * first. No creator identity exposed — see OpenRoomSummary.
   */
  listOpenRooms(): OpenRoomSummary[] {
    const result: OpenRoomSummary[] = [];
    for (const room of Array.from(this.rooms.values())) {
      if (this.statusOf(room) !== "lobby") continue;
      const seats = Object.values(room.seats);
      const seatsOpen = seats.filter((s) => s.kind === "open").length;
      if (seatsOpen === 0) continue;
      const seatsHuman = seats.filter((s) => s.kind === "human").length;
      result.push({ roomId: room.id, createdAt: room.createdAt, seatsHuman, seatsOpen });
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  // In-room only, no moderation, never persisted — a coordination channel for
  // seated players, not a durable record. Attributed by physical seat (no
  // handles/identity exposure needed for people already playing together).

  /** Send a chat message. Requires the sender to currently hold a seat in the room. */
  sendChatMessage(id: string, userId: string, text: string): ChatMessage | null {
    const room = this.rooms.get(id);
    if (!room || room.closedAt !== null) return null;
    const seat = this.seatOf(room, userId);
    if (!seat) return null;
    const trimmed = text.trim().slice(0, CHAT_MAX_LENGTH);
    if (!trimmed) return null;

    const message: ChatMessage = { seat, text: trimmed, at: Date.now() };
    room.chatLog.push(message);
    if (room.chatLog.length > CHAT_HISTORY_LIMIT) room.chatLog.shift();
    return message;
  }

  /** Recent chat history for a room — pushed to a client on connect so joining/reconnecting isn't a blank slate. */
  chatHistory(id: string): ChatMessage[] {
    return this.rooms.get(id)?.chatLog ?? [];
  }
}

/** Process-wide singleton used by the API/gateway layer. */
export const roomManager = new RoomManager();
