import {
  generateWall,
  shuffleWall,
  dealHands,
  SEAT_ORDER,
} from "./tiles";
import type { Tile, PlayerId, TileState } from "./tiles";
import { evaluateHand } from "./evaluator";
import type { EvalResult } from "./evaluator";
import { PATTERNS } from "./patterns";
import type { HandPattern, HandPatternTemplate } from "./patterns";
import type { CpuStrategy, ClaimType, SeatStrategies } from "./cpu";
import { DIFFICULTY_PRESETS, chooseTilesForCharleston, shouldStopCharleston, chooseCourtesyCount } from "./cpu";

// =============================================================================
// Meld
// =============================================================================

export interface Meld {
  type: "pung" | "kong" | "quint";
  tiles: Tile[];
  claimedFrom: PlayerId | null; // null if not from a discard
}

// =============================================================================
// Game phase / pending action
// =============================================================================

/**
 * What the game loop is waiting for.
 *
 * null                   → game auto-advances (next CPU action or setup)
 * human_discard          → waiting for human to pick a tile to discard
 * claim_window           → waiting for human to claim or pass on a discard
 * human_charleston_pass  → human selects 3 tiles to pass this Charleston step
 * human_charleston_stop  → human decides whether to start Second Charleston
 */
export type PendingAction =
  | null
  | { type: "human_discard" }
  | {
      type: "claim_window";
      discard: Tile;
      discardedBy: PlayerId;
      /**
       * Every human seat (other than the discarder) eligible to claim, and
       * what they can claim. In a redacted PlayerView this only ever contains
       * the viewer's own entry (leaking another seat's eligibility would leak
       * hand info — see lib/server/redact.ts).
       */
      eligibleSeats: Partial<Record<PlayerId, ClaimType[]>>;
      /** Responses collected so far from eligible seats. Empty in a redacted view. */
      responses: Partial<Record<PlayerId, ClaimType | "pass">>;
    }
  | { type: "human_charleston_pass"; step: number }
  | {
      type: "human_charleston_stop";
      /**
       * Votes so far: CPU seats are pre-filled when this pauses, human seats
       * are added as each one votes. true = wants to stop (skip the Second
       * Charleston). Safe to share in full — a vote reveals no hand info.
       */
      votes: Partial<Record<PlayerId, boolean>>;
    }
  | {
      /** After Second Charleston: the across-CPU has proposed a courtesy count; human responds. */
      type: "human_courtesy_propose";
      acrossSeat: PlayerId;
      cpuProposal: number;
    }
  | {
      /** Both sides agreed on `count` (> 0); human selects which tiles to pass. */
      type: "human_courtesy_select";
      acrossSeat: PlayerId;
      count: number;
    };

export type GamePhase = "setup" | "charleston" | "playing" | "finished";

// =============================================================================
// Charleston state
// =============================================================================

export interface CharlestonState {
  /** Current step: 0=FirstRight, 1=FirstAcross, 2=FirstLeft, 3=SecondLeft, 4=SecondAcross, 5=SecondRight */
  step: number;
  /** Tile IDs each player has staged to pass this step (CPUs stage immediately, human via action). */
  staged: Partial<Record<PlayerId, string[]>>;
  /**
   * Tile IDs each player received in the most-recent pass. Used by the UI to allow
   * blind passes on steps 2 and 5 — the player may include received tiles without
   * looking at them when picking what to pass next.
   */
  lastReceived: Partial<Record<PlayerId, string[]>>;
}

/**
 * Courtesy pass state — only present after Second Charleston completes.
 * Two independent across-table negotiations happen in parallel (E↔W and S↔N).
 * For each pair we record the proposed count and the chosen tile IDs.
 */
export interface CourtesyState {
  /** Proposed count from each player (0–3). Null until they propose. */
  proposals: Partial<Record<PlayerId, number>>;
  /** Tiles each player has chosen to pass once both counts agree. */
  selections: Partial<Record<PlayerId, string[]>>;
}

export const CHARLESTON_STEPS: Array<{
  direction: "right" | "across" | "left";
  label: string;
  charleston: 1 | 2;
}> = [
  { direction: "right",  label: "Pass Right",  charleston: 1 },
  { direction: "across", label: "Pass Across", charleston: 1 },
  { direction: "left",   label: "Pass Left",   charleston: 1 },
  { direction: "left",   label: "Pass Left",   charleston: 2 },
  { direction: "across", label: "Pass Across", charleston: 2 },
  { direction: "right",  label: "Pass Right",  charleston: 2 },
];

// sender → recipient for each direction
export const PASSES_TO: Record<"right" | "across" | "left", Record<PlayerId, PlayerId>> = {
  right:  { E: "S", S: "W", W: "N", N: "E" },
  across: { E: "W", W: "E", S: "N", N: "S" },
  left:   { E: "N", N: "W", W: "S", S: "E" },
};

// recipient → sender (inverse of PASSES_TO)
const RECEIVES_FROM: Record<"right" | "across" | "left", Record<PlayerId, PlayerId>> = {
  right:  { E: "N", S: "E", W: "S", N: "W" },
  across: { E: "W", W: "E", S: "N", N: "S" },
  left:   { E: "S", S: "W", W: "N", N: "E" },
};

// =============================================================================
// Game state
// =============================================================================

export interface GameState {
  phase: GamePhase;
  wall: Tile[];               // remaining undrawn tiles (index 0 = next draw)
  hands: Record<PlayerId, Tile[]>;
  melds: Record<PlayerId, Meld[]>;
  discardPile: Record<PlayerId, Tile[]>;
  currentSeat: PlayerId;
  lastDiscard: Tile | null;
  turnNumber: number;
  winner: PlayerId | null;
  winningPattern: HandPattern | null;
  /** How the win happened — null until a winner is set. Drives multiplayer scoring (see lib/server/match.ts). */
  winKind: "discard" | "self_draw" | null;
  /** The seat whose discard was claimed for mahjong, when winKind is "discard". */
  winDiscardedBy: PlayerId | null;
  pendingAction: PendingAction;
  log: string[];              // human-readable event log for the UI
  charleston: CharlestonState | null;
  courtesy: CourtesyState | null;
  /** The most recently drawn-from-the-wall tile (seat + tile ID). Reset on each new draw. */
  lastDraw: { seat: PlayerId; tileId: string } | null;
}

// =============================================================================
// Actions dispatched into the game engine
// =============================================================================

export type GameAction =
  | { type: "START_GAME"; humanSeat?: PlayerId; strategies?: SeatStrategies }
  | { type: "HUMAN_DISCARD"; tileId: string }
  | { type: "HUMAN_CLAIM"; claimType: ClaimType; seat?: PlayerId }
  | { type: "HUMAN_PASS"; seat?: PlayerId }
  | { type: "HUMAN_STAGE_CHARLESTON"; tileIds: string[]; seat?: PlayerId }
  | { type: "STOP_CHARLESTON"; seat?: PlayerId }
  | { type: "BEGIN_SECOND_CHARLESTON"; seat?: PlayerId }
  | { type: "HUMAN_COURTESY_RESPOND"; count: number }
  | { type: "HUMAN_COURTESY_PASS"; tileIds: string[] }
  | {
      /** Human swaps a natural tile from hand for a joker exposed in someone's meld. */
      type: "HUMAN_JOKER_SWAP";
      meldOwnerSeat: PlayerId;
      meldIndex: number;
      jokerTileId: string;
      handTileId: string;
    }
  | { type: "ADVANCE_CPU" }  // caller triggers each CPU step (enables animation pacing)
  | { type: "RUN_TO_COMPLETION" }  // runs entire game synchronously in one reducer call
  | { type: "SET_STATE"; state: GameState }  // replace state directly (used by ludicrous step-loop)
  | { type: "RESET" }
  | {
      /**
       * A seat has just been removed from ctx.humanSeats (kicked or forfeited —
       * see lib/server/gameRoom.ts's convertSeatToCpu) and any obligation it
       * still owed the game needs resolving with a synthesized CPU decision so
       * the room isn't left permanently stalled waiting on someone who can no
       * longer submit(). Courtesy pass needs no case: GameRoom's drive() always
       * auto-declines it regardless of humanSeats, so it's never left pending.
       */
      type: "CONVERT_TO_CPU";
      seat: PlayerId;
    };

// =============================================================================
// Helpers
// =============================================================================

const NEXT_SEAT: Record<PlayerId, PlayerId> = {
  E: "S", S: "W", W: "N", N: "E",
};

/** Across-table partner for courtesy pass. */
const ACROSS: Record<PlayerId, PlayerId> = {
  E: "W", W: "E", S: "N", N: "S",
};

function nextSeat(seat: PlayerId): PlayerId {
  return NEXT_SEAT[seat];
}

function addLog(log: string[], msg: string): string[] {
  return [...log, msg];
}

function tileLabel(t: Tile): string {
  if (t.suit === "wind" || t.suit === "dragon") return `${t.val}`;
  if (t.suit === "flower") return "Fl";
  if (t.suit === "joker") return "Jkr";
  const suffix = t.suit === "dots" ? "d" : t.suit === "bams" ? "b" : "c";
  return `${t.val}${suffix}`;
}

function setTileState(tile: Tile, state: TileState, owner: PlayerId | null): Tile {
  return { ...tile, state, owner };
}

/**
 * Draw from the live wall (index 0). Returns [drawnTile, remainingWall].
 */
function drawFromWall(wall: Tile[]): [Tile, Tile[]] {
  if (wall.length === 0) throw new Error("Wall is empty");
  const [drawn, ...rest] = wall;
  return [setTileState(drawn, "in_hand", null), rest];
}

/**
 * Check if a player's 14-tile hand is a winning hand.
 */
function isWinningHand(hand: Tile[], wall: Tile[], patterns: HandPatternTemplate[]): boolean {
  if (hand.length !== 14) return false;
  return evaluateHand(hand, wall, patterns).shanten === -1;
}

/**
 * Determine which claim types are eligible given a discard and a hand.
 * Mahjong is always listed first.
 */
function eligibleClaims(
  discard: Tile,
  hand: Tile[],
  wall: Tile[],
  patterns: HandPatternTemplate[]
): ClaimType[] {
  // NMJL: a discarded joker is a dead tile — cannot be called or used to complete a hand.
  if (discard.suit === "joker") return [];

  const types: ClaimType[] = [];

  // Mahjong: adding this tile completes the hand
  if (isWinningHand([...hand, discard], wall, patterns)) {
    types.push("mahjong");
  }

  const matching = hand.filter(t => t.suit === discard.suit && t.val === discard.val).length;
  const jokers = hand.filter(t => t.suit === "joker").length;

  // NMJL rule: the discarded tile itself counts toward the meld, so a claim is
  // legal whenever (naturals in hand) + (jokers in hand) cover the remaining slots.
  // Jokers alone can fill the rest — no separate "must hold a natural" requirement.
  if (matching + jokers >= 4) types.push("quint");
  if (matching + jokers >= 3) types.push("kong");
  if (matching + jokers >= 2) types.push("pung");

  return types;
}

// =============================================================================
// Initial state factory
// =============================================================================

export function createGameState(): GameState {
  return {
    phase: "setup",
    wall: [],
    hands: { E: [], S: [], W: [], N: [] },
    melds: { E: [], S: [], W: [], N: [] },
    discardPile: { E: [], S: [], W: [], N: [] },
    currentSeat: "E",
    lastDiscard: null,
    turnNumber: 0,
    winner: null,
    winningPattern: null,
    winKind: null,
    winDiscardedBy: null,
    pendingAction: null,
    log: [],
    charleston: null,
    courtesy: null,
    lastDraw: null,
  };
}

// =============================================================================
// Game engine reducer
// =============================================================================

/**
 * Strategies are stored outside the reducer (they contain functions, which
 * can't be serialized). The hook passes them in on each dispatch.
 */
export interface EngineContext {
  /**
   * The seat that drives the single-human flows (Charleston, courtesy, claim
   * window). Kept for those paths; the play loop uses `humanSeats` below.
   */
  humanSeat: PlayerId;
  /**
   * Every seat played by a human. The play loop (draw/discard/claim resolution)
   * pauses on any of these and never auto-plays them as CPUs. Single-player /
   * observe pass a one-element set; multiplayer passes the real set.
   */
  humanSeats: Set<PlayerId>;
  strategies: SeatStrategies;
  patterns: HandPatternTemplate[];
}

export function gameReducer(
  state: GameState,
  action: GameAction,
  ctx: EngineContext
): GameState {
  switch (action.type) {

    // ── START_GAME ────────────────────────────────────────────────────────────
    case "START_GAME": {
      const wall = shuffleWall(generateWall());
      const { hands: dealtHands, wall: remaining } = dealHands(wall);

      let newState: GameState = {
        ...createGameState(),
        phase: "charleston",
        wall: remaining,
        hands: dealtHands as Record<PlayerId, Tile[]>,
        charleston: { step: 0, staged: {}, lastReceived: {} },
        log: ["Game started. Charleston begins — First Charleston."],
        pendingAction: null,
      };

      // CPUs immediately stage their tiles for step 0
      newState = cpuStageCharleston(newState, ctx, 0);
      newState = { ...newState, pendingAction: { type: "human_charleston_pass", step: 0 } };

      // If there's no real human to wait for (all-CPU room), this resolves the
      // whole Charleston synchronously right here.
      return maybeAdvanceCharleston(newState, ctx);
    }

    // ── HUMAN_STAGE_CHARLESTON ─────────────────────────────────────────────
    // A staging barrier: every human seat must stage before the step executes.
    // CPU seats already staged immediately when this step opened.
    case "HUMAN_STAGE_CHARLESTON": {
      if (state.pendingAction?.type !== "human_charleston_pass") return state;
      if (!state.charleston) return state;

      const { tileIds, seat } = action;
      if (!seat || !ctx.humanSeats.has(seat)) return state;
      if (state.charleston.staged[seat]) return state; // already staged this step
      if (tileIds.length !== 3) return state;

      const hand = state.hands[seat];
      const tiles = tileIds.map(id => hand.find(t => t.id === id)).filter(Boolean) as Tile[];
      if (tiles.length !== 3) return state;
      if (tiles.some(t => t.suit === "joker")) return state;

      const staged = { ...state.charleston.staged, [seat]: tileIds };
      return maybeAdvanceCharleston({ ...state, charleston: { ...state.charleston, staged } }, ctx);
    }

    // ── STOP_CHARLESTON / BEGIN_SECOND_CHARLESTON ──────────────────────────
    // Each human seat casts one vote. Second Charleston is skipped if ANY seat
    // (human or CPU) votes to stop — it plays only if every seat wants to.
    // A decisive stop vote resolves immediately without waiting for the rest.
    case "STOP_CHARLESTON": {
      if (state.pendingAction?.type !== "human_charleston_stop") return state;
      const pa = state.pendingAction;
      const seat = action.seat;
      if (!seat || !ctx.humanSeats.has(seat) || pa.votes[seat] !== undefined) return state;
      const votes = { ...pa.votes, [seat]: true };
      return maybeResolveCharlestonVote({ ...state, pendingAction: { ...pa, votes } }, ctx);
    }

    case "BEGIN_SECOND_CHARLESTON": {
      if (state.pendingAction?.type !== "human_charleston_stop") return state;
      const pa = state.pendingAction;
      const seat = action.seat;
      if (!seat || !ctx.humanSeats.has(seat) || pa.votes[seat] !== undefined) return state;
      const votes = { ...pa.votes, [seat]: false };
      return maybeResolveCharlestonVote({ ...state, pendingAction: { ...pa, votes } }, ctx);
    }

    // ── HUMAN_COURTESY_RESPOND ─────────────────────────────────────────────
    // Human responds to the across-CPU's proposal with their own count (0-3).
    // The pair-effective count is min(human, cpu). If 0 → no exchange for this pair.
    // The other-diagonal CPU pair resolves automatically.
    case "HUMAN_COURTESY_RESPOND": {
      if (state.pendingAction?.type !== "human_courtesy_propose") return state;
      const { acrossSeat, cpuProposal } = state.pendingAction;
      const humanProposal = Math.max(0, Math.min(3, Math.floor(action.count)));
      const effective = Math.min(humanProposal, cpuProposal);

      const courtesy: CourtesyState = {
        proposals: {
          ...(state.courtesy?.proposals ?? {}),
          [ctx.humanSeat]: humanProposal,
          [acrossSeat]: cpuProposal,
        },
        selections: { ...(state.courtesy?.selections ?? {}) },
      };

      if (effective === 0) {
        const log = addLog(state.log, `No courtesy pass with ${acrossSeat} (lower of ${humanProposal} and ${cpuProposal}).`);
        return resolveOtherDiagonalAndFinish({ ...state, courtesy }, ctx, log);
      }

      // CPU picks its courtesy tiles immediately
      const cpuStrategy = ctx.strategies[acrossSeat] ?? DIFFICULTY_PRESETS.intermediate;
      const cpuTiles = chooseTilesForCharleston(cpuStrategy, state.hands[acrossSeat], state.wall, ctx.patterns, effective);
      courtesy.selections[acrossSeat] = cpuTiles.map(t => t.id);

      return {
        ...state,
        courtesy,
        pendingAction: { type: "human_courtesy_select", acrossSeat, count: effective },
      };
    }

    // ── HUMAN_COURTESY_PASS ────────────────────────────────────────────────
    case "HUMAN_COURTESY_PASS": {
      if (state.pendingAction?.type !== "human_courtesy_select") return state;
      const { acrossSeat, count } = state.pendingAction;
      const { tileIds } = action;
      if (tileIds.length !== count) return state;

      const humanHand = state.hands[ctx.humanSeat];
      const humanTiles = tileIds.map(id => humanHand.find(t => t.id === id)).filter(Boolean) as Tile[];
      if (humanTiles.length !== count) return state;
      if (humanTiles.some(t => t.suit === "joker")) return state;

      const courtesy: CourtesyState = {
        proposals: state.courtesy?.proposals ?? {},
        selections: { ...(state.courtesy?.selections ?? {}), [ctx.humanSeat]: tileIds },
      };

      const exchanged = executeCourtesyPair(state, ctx.humanSeat, acrossSeat, courtesy);
      const log = addLog(state.log, `Courtesy: exchanged ${count} tile${count === 1 ? "" : "s"} with ${acrossSeat}.`);
      return resolveOtherDiagonalAndFinish({ ...exchanged, courtesy }, ctx, log);
    }

    // ── HUMAN_DISCARD ─────────────────────────────────────────────────────────
    case "HUMAN_DISCARD": {
      if (state.pendingAction?.type !== "human_discard") return state;
      // The discarding seat is whoever's turn it is — supports multiple humans.
      const seat = state.currentSeat;
      const tile = state.hands[seat].find(t => t.id === action.tileId);
      if (!tile) return state;

      return processDiscard(state, ctx, seat, tile);
    }

    // ── HUMAN_JOKER_SWAP ───────────────────────────────────────────────────
    // Swap a natural tile from the acting seat's hand for a joker in any
    // exposed meld. Legal only on that seat's own turn (pendingAction === human_discard).
    case "HUMAN_JOKER_SWAP": {
      if (state.pendingAction?.type !== "human_discard") return state;
      const swap = validateJokerSwap(
        state,
        state.currentSeat,
        action.meldOwnerSeat,
        action.meldIndex,
        action.jokerTileId,
        action.handTileId
      );
      if (!swap) return state;
      return applyJokerSwap(state, swap);
    }

    // ── HUMAN_CLAIM ───────────────────────────────────────────────────────────
    // A claim window is a bounded race: every eligible human seat must respond
    // (claim or pass) before it resolves — EXCEPT mahjong, which beats every
    // other possible claim and so resolves immediately without waiting.
    case "HUMAN_CLAIM": {
      if (state.pendingAction?.type !== "claim_window") return state;
      const pa = state.pendingAction;
      const seat = action.seat;
      if (!seat) return state;
      const eligible = pa.eligibleSeats[seat];
      if (!eligible || pa.responses[seat] !== undefined) return state;
      if (!eligible.includes(action.claimType)) return state;

      if (action.claimType === "mahjong") {
        return applyMahjongWin(state, ctx, seat, [...state.hands[seat], pa.discard], "discard", pa.discardedBy);
      }

      const responses = { ...pa.responses, [seat]: action.claimType };
      return maybeResolveClaimWindow({ ...state, pendingAction: { ...pa, responses } }, ctx);
    }

    // ── HUMAN_PASS ────────────────────────────────────────────────────────────
    case "HUMAN_PASS": {
      if (state.pendingAction?.type !== "claim_window") return state;
      const pa = state.pendingAction;
      const seat = action.seat;
      if (!seat || pa.eligibleSeats[seat] === undefined || pa.responses[seat] !== undefined) return state;

      const responses = { ...pa.responses, [seat]: "pass" as const };
      return maybeResolveClaimWindow({ ...state, pendingAction: { ...pa, responses } }, ctx);
    }

    // ── ADVANCE_CPU ───────────────────────────────────────────────────────────
    case "ADVANCE_CPU": {
      if (state.phase !== "playing") return state;
      if (state.pendingAction !== null) return state; // waiting for human

      const seat = state.currentSeat;
      if (ctx.humanSeats.has(seat)) return state; // not a CPU seat

      return runCpuTurn(state, ctx, seat);
    }

    // ── RUN_TO_COMPLETION ─────────────────────────────────────────────────────
    case "RUN_TO_COMPLETION": {
      let s = state;
      let maxTurns = 1000;
      while ((s.phase === "charleston" || s.phase === "playing") && maxTurns-- > 0) {
        if (s.phase === "charleston") {
          if (s.pendingAction?.type === "human_charleston_pass") {
            const hand = s.hands[ctx.humanSeat];
            const strategy = ctx.strategies[ctx.humanSeat] ?? DIFFICULTY_PRESETS.intermediate;
            const tiles = chooseTilesForCharleston(strategy, hand, s.wall, ctx.patterns);
            s = gameReducer(s, { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles.map(t => t.id), seat: ctx.humanSeat }, ctx);
          } else if (s.pendingAction?.type === "human_charleston_stop") {
            s = gameReducer(s, { type: "BEGIN_SECOND_CHARLESTON", seat: ctx.humanSeat }, ctx);
          } else {
            break;
          }
        } else {
          if (s.pendingAction === null) {
            s = gameReducer(s, { type: "ADVANCE_CPU" }, ctx);
          } else if (s.pendingAction.type === "human_discard") {
            const hand = s.hands[ctx.humanSeat];
            if (!hand?.length) break;
            const strategy = ctx.strategies[ctx.humanSeat] ?? DIFFICULTY_PRESETS.intermediate;
            const evalResult = evaluateHand(hand, s.wall, ctx.patterns);
            const choice = strategy.chooseDiscard(hand, evalResult, s.wall, ctx.patterns);
            s = gameReducer(s, { type: "HUMAN_DISCARD", tileId: choice.id }, ctx);
          } else if (s.pendingAction.type === "claim_window") {
            s = gameReducer(s, { type: "HUMAN_PASS", seat: ctx.humanSeat }, ctx);
          } else {
            break;
          }
        }
      }
      return s;
    }

    // ── CONVERT_TO_CPU ──────────────────────────────────────────────────────
    case "CONVERT_TO_CPU": {
      const { seat } = action;
      const pa = state.pendingAction;

      if (state.phase === "charleston" && state.charleston) {
        if (pa?.type === "human_charleston_pass" && !state.charleston.staged[seat]) {
          const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
          const tiles = chooseTilesForCharleston(strategy, state.hands[seat], state.wall, ctx.patterns);
          const staged = { ...state.charleston.staged, [seat]: tiles.map(t => t.id) };
          return maybeAdvanceCharleston({ ...state, charleston: { ...state.charleston, staged } }, ctx);
        }
        if (pa?.type === "human_charleston_stop" && pa.votes[seat] === undefined) {
          const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
          const vote = shouldStopCharleston(strategy, state.hands[seat], state.wall, ctx.patterns);
          const votes = { ...pa.votes, [seat]: vote };
          return maybeResolveCharlestonVote({ ...state, pendingAction: { ...pa, votes } }, ctx);
        }
        return state; // nothing currently pending for this seat
      }

      if (state.phase === "playing") {
        if (pa?.type === "human_discard" && state.currentSeat === seat) {
          // Clearing pendingAction hands control to the normal ADVANCE_CPU path —
          // GameRoom.drive() calls it next and currentSeat is no longer human.
          return { ...state, pendingAction: null };
        }
        if (pa?.type === "claim_window" && pa.eligibleSeats[seat] !== undefined && pa.responses[seat] === undefined) {
          const { [seat]: _dropped, ...eligibleSeats } = pa.eligibleSeats;
          // No response needs synthesizing here: resolveClaimWindow computes a
          // fresh CPU candidate for every seat outside ctx.humanSeats on its
          // own, and `seat` no longer is one — it's picked up automatically.
          return maybeResolveClaimWindow({ ...state, pendingAction: { ...pa, eligibleSeats } }, ctx);
        }
        return state;
      }

      return state;
    }

    // ── SET_STATE ─────────────────────────────────────────────────────────────
    case "SET_STATE":
      return action.state;

    // ── RESET ─────────────────────────────────────────────────────────────────
    case "RESET":
      return createGameState();

    default:
      return state;
  }
}

// =============================================================================
// Internal Charleston helpers
// =============================================================================

/** Have every CPU seat stage their 3 tiles for `step`. Real human seats stage via HUMAN_STAGE_CHARLESTON. */
function cpuStageCharleston(state: GameState, ctx: EngineContext, step: number): GameState {
  const staged = { ...(state.charleston?.staged ?? {}) };

  for (const seat of SEAT_ORDER) {
    if (ctx.humanSeats.has(seat)) continue;
    const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
    const tiles = chooseTilesForCharleston(strategy, state.hands[seat], state.wall, ctx.patterns);
    staged[seat] = tiles.map(t => t.id);
  }

  return { ...state, charleston: { ...state.charleston!, staged } };
}

/**
 * Staging barrier: if every human seat has staged for the current step,
 * execute the exchange and advance (recursing into the next step, which may
 * itself already be fully staged — e.g. an all-CPU room resolves the whole
 * Charleston in one synchronous call). Otherwise returns state unchanged,
 * genuinely waiting on the remaining human seat(s).
 */
function maybeAdvanceCharleston(state: GameState, ctx: EngineContext): GameState {
  const pa = state.pendingAction;
  if (pa?.type !== "human_charleston_pass" || !state.charleston) return state;
  const step = state.charleston.step;
  const allStaged = Array.from(ctx.humanSeats).every(s => state.charleston!.staged[s]);
  if (!allStaged) return state;

  let newState = executeCharleston(state, step);
  const nextStep = step + 1;

  // After First Charleston (steps 0–2): every seat votes on the Second.
  if (nextStep === 3) {
    const cpuSeats = SEAT_ORDER.filter(s => !ctx.humanSeats.has(s));
    const votes: Partial<Record<PlayerId, boolean>> = {};
    for (const seat of cpuSeats) {
      const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
      votes[seat] = shouldStopCharleston(strategy, newState.hands[seat], newState.wall, ctx.patterns);
    }
    return maybeResolveCharlestonVote(
      {
        ...newState,
        charleston: { ...newState.charleston!, step: nextStep, staged: {} },
        pendingAction: { type: "human_charleston_stop", votes },
      },
      ctx,
    );
  }

  // After all 6 steps — Second Charleston was played, so begin courtesy phase.
  if (nextStep > 5) {
    return startCourtesyOrFinish(addLog(newState.log, "Charleston complete."), newState, ctx, /* hadSecond */ true);
  }

  newState = { ...newState, charleston: { ...newState.charleston!, step: nextStep, staged: {} } };
  newState = cpuStageCharleston(newState, ctx, nextStep);
  newState = { ...newState, pendingAction: { type: "human_charleston_pass", step: nextStep } };
  return maybeAdvanceCharleston(newState, ctx);
}

/**
 * Resolve the Second-Charleston vote once possible: a stop vote (from anyone,
 * human or CPU) is decisive immediately — no other vote can undo it. Otherwise
 * waits until every human seat has voted; if nobody stopped it, begins step 3.
 */
function maybeResolveCharlestonVote(state: GameState, ctx: EngineContext): GameState {
  const pa = state.pendingAction;
  if (pa?.type !== "human_charleston_stop") return state;

  const stopper = SEAT_ORDER.find(s => pa.votes[s] === true);
  if (stopper) {
    return startCourtesyOrFinish(
      addLog(state.log, `${stopper} votes to skip — Second Charleston ends.`),
      state,
      ctx,
      /* hadSecond */ false,
    );
  }

  const stillWaiting = Array.from(ctx.humanSeats).some(s => pa.votes[s] === undefined);
  if (stillWaiting) return state;

  let newState: GameState = {
    ...state,
    charleston: { ...state.charleston!, step: 3, staged: {} },
    log: addLog(state.log, "Second Charleston begins."),
  };
  newState = cpuStageCharleston(newState, ctx, 3);
  newState = { ...newState, pendingAction: { type: "human_charleston_pass", step: 3 } };
  return maybeAdvanceCharleston(newState, ctx);
}

/** Execute the tile exchange for `step`, using whatever is in `charleston.staged`. */
function executeCharleston(state: GameState, step: number): GameState {
  const { staged } = state.charleston!;
  const direction = CHARLESTON_STEPS[step].direction;
  const receivesFrom = RECEIVES_FROM[direction];

  const newHands: Record<PlayerId, Tile[]> = {} as Record<PlayerId, Tile[]>;
  const lastReceived: Partial<Record<PlayerId, string[]>> = {};

  for (const seat of SEAT_ORDER) {
    const passingIds = new Set(staged[seat] ?? []);
    const senderSeat = receivesFrom[seat];
    const receivingTiles = (state.hands[senderSeat] ?? []).filter(t =>
      (staged[senderSeat] ?? []).includes(t.id)
    );
    newHands[seat] = [
      ...state.hands[seat].filter(t => !passingIds.has(t.id)),
      ...receivingTiles,
    ];
    lastReceived[seat] = receivingTiles.map(t => t.id);
  }

  const { label, charleston: charlNum } = CHARLESTON_STEPS[step];
  return {
    ...state,
    hands: newHands,
    charleston: { ...state.charleston!, staged: {}, lastReceived },
    log: addLog(state.log, `Charleston ${charlNum}: ${label} complete.`),
  };
}

/**
 * Charleston is over (either after step 5 or after a unanimous skip after step 2).
 * If the Second Charleston was played, kick off the courtesy phase; otherwise
 * skip straight to playing.
 */
function startCourtesyOrFinish(
  log: string[],
  state: GameState,
  ctx: EngineContext,
  hadSecond: boolean
): GameState {
  if (!hadSecond) {
    return finishCharleston(log, state, ctx);
  }

  const acrossSeat = ACROSS[ctx.humanSeat];
  const cpuStrategy = ctx.strategies[acrossSeat] ?? DIFFICULTY_PRESETS.intermediate;
  const cpuProposal = chooseCourtesyCount(cpuStrategy, state.hands[acrossSeat], state.wall, ctx.patterns);

  return {
    ...state,
    log,
    courtesy: { proposals: { [acrossSeat]: cpuProposal }, selections: {} },
    pendingAction: { type: "human_courtesy_propose", acrossSeat, cpuProposal },
  };
}

/**
 * After the human's diagonal is resolved, settle the other-diagonal CPU pair
 * (both seats are CPUs), then finish.
 */
function resolveOtherDiagonalAndFinish(
  state: GameState,
  ctx: EngineContext,
  log: string[]
): GameState {
  const humanDiagonal = new Set<PlayerId>([ctx.humanSeat, ACROSS[ctx.humanSeat]]);
  const otherPair = SEAT_ORDER.filter(s => !humanDiagonal.has(s));
  if (otherPair.length !== 2) {
    return finishCharleston(log, state, ctx);
  }
  const [a, b] = otherPair;
  const sa = ctx.strategies[a] ?? DIFFICULTY_PRESETS.intermediate;
  const sb = ctx.strategies[b] ?? DIFFICULTY_PRESETS.intermediate;
  const propA = chooseCourtesyCount(sa, state.hands[a], state.wall, ctx.patterns);
  const propB = chooseCourtesyCount(sb, state.hands[b], state.wall, ctx.patterns);
  const count = Math.min(propA, propB);

  let nextState = state;
  let nextLog = log;
  if (count > 0) {
    const tilesA = chooseTilesForCharleston(sa, state.hands[a], state.wall, ctx.patterns, count);
    const tilesB = chooseTilesForCharleston(sb, state.hands[b], state.wall, ctx.patterns, count);
    const courtesy: CourtesyState = {
      proposals: { ...(state.courtesy?.proposals ?? {}), [a]: propA, [b]: propB },
      selections: {
        ...(state.courtesy?.selections ?? {}),
        [a]: tilesA.map(t => t.id),
        [b]: tilesB.map(t => t.id),
      },
    };
    nextState = executeCourtesyPair(state, a, b, courtesy);
    nextState = { ...nextState, courtesy };
    nextLog = addLog(log, `${a} and ${b} exchange ${count} courtesy tile${count === 1 ? "" : "s"}.`);
  } else {
    nextLog = addLog(log, `No courtesy pass between ${a} and ${b}.`);
  }

  return finishCharleston(nextLog, nextState, ctx);
}

/** Swap the selected tiles between two seats. Both seats must have a `selections` entry. */
function executeCourtesyPair(
  state: GameState,
  seatA: PlayerId,
  seatB: PlayerId,
  courtesy: CourtesyState
): GameState {
  const aIds = new Set(courtesy.selections[seatA] ?? []);
  const bIds = new Set(courtesy.selections[seatB] ?? []);
  const aTiles = state.hands[seatA].filter(t => aIds.has(t.id));
  const bTiles = state.hands[seatB].filter(t => bIds.has(t.id));

  const newHands = {
    ...state.hands,
    [seatA]: [...state.hands[seatA].filter(t => !aIds.has(t.id)), ...bTiles],
    [seatB]: [...state.hands[seatB].filter(t => !bIds.has(t.id)), ...aTiles],
  };
  return { ...state, hands: newHands };
}

/** Transition from Charleston to playing: East draws, set phase. */
function finishCharleston(log: string[], state: GameState, ctx: EngineContext): GameState {
  const [drawn, wallAfter] = drawFromWall(state.wall);
  const eastHand = [...state.hands["E"], drawn];

  return {
    ...state,
    phase: "playing",
    wall: wallAfter,
    hands: { ...state.hands, E: eastHand },
    charleston: null,
    currentSeat: "E",
    turnNumber: 0,
    log: addLog(log, "East draws to begin play."),
    pendingAction: ctx.humanSeats.has("E") ? { type: "human_discard" } : null,
    lastDraw: { seat: "E", tileId: drawn.id },
  };
}

// =============================================================================
// Internal turn logic
// =============================================================================

function processDiscard(
  state: GameState,
  ctx: EngineContext,
  seat: PlayerId,
  tile: Tile
): GameState {
  const discardedTile = setTileState(tile, "discarded", seat);
  const hand = state.hands[seat].filter(t => t.id !== tile.id);

  let newState: GameState = {
    ...state,
    hands: { ...state.hands, [seat]: hand },
    discardPile: {
      ...state.discardPile,
      [seat]: [...state.discardPile[seat], discardedTile],
    },
    lastDiscard: discardedTile,
    log: addLog(state.log, `${seat} discards ${tileLabel(tile)}`),
    pendingAction: null,
  };

  // Check if any player can claim this discard
  // Priority: mahjong > human player > random CPU
  return openClaimWindow(newState, ctx, discardedTile, seat);
}

/**
 * Open a claim window. Every human seat (other than the discarder) eligible
 * to claim something gets a pendingAction and must respond; if none is
 * eligible, resolves immediately among CPU seats (no one to wait for).
 */
function openClaimWindow(
  state: GameState,
  ctx: EngineContext,
  discard: Tile,
  discardedBy: PlayerId
): GameState {
  const eligibleSeats: Partial<Record<PlayerId, ClaimType[]>> = {};
  for (const seat of Array.from(ctx.humanSeats)) {
    if (seat === discardedBy) continue;
    const hand = state.hands[seat];
    if (!hand) continue; // guard against an invalid humanSeat in tests
    const types = eligibleClaims(discard, hand, state.wall, ctx.patterns);
    if (types.length > 0) eligibleSeats[seat] = types;
  }

  if (Object.keys(eligibleSeats).length === 0) {
    return resolveClaimWindow(state, ctx, discard, discardedBy, {});
  }

  return {
    ...state,
    pendingAction: { type: "claim_window", discard, discardedBy, eligibleSeats, responses: {} },
  };
}

/** If every eligible seat has responded, resolve the window; otherwise wait. */
function maybeResolveClaimWindow(state: GameState, ctx: EngineContext): GameState {
  const pa = state.pendingAction;
  if (pa?.type !== "claim_window") return state;
  const stillWaiting = Object.keys(pa.eligibleSeats).some(
    s => pa.responses[s as PlayerId] === undefined
  );
  if (stillWaiting) return state;
  return resolveClaimWindow(state, ctx, pa.discard, pa.discardedBy, pa.responses);
}

const CLAIM_RANK: Record<ClaimType, number> = { mahjong: 3, quint: 2, kong: 1, pung: 0 };

/** How many turn-order hops from `discardedBy` to reach `seat` — used to break priority ties. */
function turnOrderDistance(discardedBy: PlayerId, seat: PlayerId): number {
  let d = 0;
  let s = discardedBy;
  while (s !== seat) {
    s = nextSeat(s);
    d++;
  }
  return d;
}

/**
 * Resolve a claim window: gather every human's claim (from `responses`,
 * passes excluded) plus freshly-computed CPU decisions, then pick the
 * highest-priority candidate (mahjong > quint > kong > pung; ties broken by
 * nearest seat in turn order from the discarder). No candidates → play
 * advances to the next seat's draw.
 */
function resolveClaimWindow(
  state: GameState,
  ctx: EngineContext,
  discard: Tile,
  discardedBy: PlayerId,
  humanResponses: Partial<Record<PlayerId, ClaimType | "pass">>,
): GameState {
  const candidates: Array<{ seat: PlayerId; claimType: ClaimType }> = [];

  for (const seat of SEAT_ORDER) {
    const resp = humanResponses[seat];
    if (resp && resp !== "pass") candidates.push({ seat, claimType: resp });
  }

  const cpuSeats = SEAT_ORDER.filter(s => s !== discardedBy && !ctx.humanSeats.has(s));
  for (const seat of cpuSeats) {
    const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
    if (strategy.shouldClaim(discard, state.hands[seat], "mahjong", state.wall, ctx.patterns)) {
      candidates.push({ seat, claimType: "mahjong" });
      continue;
    }
    for (const claimType of ["quint", "kong", "pung"] as const) {
      if (strategy.shouldClaim(discard, state.hands[seat], claimType, state.wall, ctx.patterns)) {
        candidates.push({ seat, claimType });
        break;
      }
    }
  }

  if (candidates.length === 0) {
    return advanceToNextDraw(state, ctx, nextSeat(discardedBy));
  }

  candidates.sort((a, b) =>
    CLAIM_RANK[b.claimType] - CLAIM_RANK[a.claimType] ||
    turnOrderDistance(discardedBy, a.seat) - turnOrderDistance(discardedBy, b.seat)
  );
  const winner = candidates[0];

  if (winner.claimType === "mahjong") {
    return applyMahjongWin(state, ctx, winner.seat, [...state.hands[winner.seat], discard], "discard", discardedBy);
  }
  return processClaim(state, ctx, winner.seat, discard, discardedBy, winner.claimType);
}

/** Construct the finished-game state for a mahjong win, shared by every win site. */
function applyMahjongWin(
  state: GameState,
  ctx: EngineContext,
  seat: PlayerId,
  handForEval: Tile[],
  kind: "discard" | "self_draw",
  discardedBy: PlayerId | null,
): GameState {
  return {
    ...state,
    winner: seat,
    winningPattern: evaluateHand(handForEval, state.wall, ctx.patterns).bestPatterns[0]?.pattern ?? null,
    winKind: kind,
    winDiscardedBy: discardedBy,
    phase: "finished",
    pendingAction: null,
    log: addLog(state.log, kind === "discard" ? `${seat} declares MAHJONG!` : `${seat} self-draws MAHJONG!`),
  };
}

function processClaim(
  state: GameState,
  ctx: EngineContext,
  claimant: PlayerId,
  discard: Tile,
  discardedBy: PlayerId,
  claimType: "pung" | "kong" | "quint"
): GameState {
  const needed = claimType === "pung" ? 2 : claimType === "kong" ? 3 : 4;
  const hand = state.hands[claimant];

  // Consume naturals first, then top up with jokers if needed.
  const naturals = hand.filter(t => t.suit === discard.suit && t.val === discard.val).slice(0, needed);
  const jokerFillCount = needed - naturals.length;
  const jokerFill = jokerFillCount > 0
    ? hand.filter(t => t.suit === "joker").slice(0, jokerFillCount)
    : [];
  const consumed = [...naturals, ...jokerFill];

  const claimedDiscard = setTileState(discard, `claimed_${claimType}` as TileState, claimant);
  const meldTiles = [
    claimedDiscard,
    ...consumed.map(t => setTileState(t, `claimed_${claimType}` as TileState, claimant)),
  ];
  const meld: Meld = { type: claimType, tiles: meldTiles, claimedFrom: discardedBy };
  const handAfterClaim = hand.filter(t => !consumed.includes(t));

  let newState: GameState = {
    ...state,
    hands: { ...state.hands, [claimant]: handAfterClaim },
    melds: { ...state.melds, [claimant]: [...state.melds[claimant], meld] },
    currentSeat: claimant,
    log: addLog(state.log, `${claimant} claims ${tileLabel(discard)} for ${claimType}`),
    pendingAction: null,
  };

  // Claimant must now discard
  if (ctx.humanSeats.has(claimant)) {
    return { ...newState, pendingAction: { type: "human_discard" } };
  }

  // CPU claimant: take any free joker swaps first, then discard.
  const afterSwaps = applyAutoJokerSwaps(newState, claimant);
  const strategy = ctx.strategies[claimant] ?? DIFFICULTY_PRESETS.intermediate;
  const handForDiscard = afterSwaps.hands[claimant];
  const evalResult = evaluateHand(handForDiscard, afterSwaps.wall, ctx.patterns);
  const discardChoice = strategy.chooseDiscard(handForDiscard, evalResult, afterSwaps.wall, ctx.patterns);
  return processDiscard(afterSwaps, ctx, claimant, discardChoice);
}

/**
 * Advance to the given seat's draw turn (normal wall draw).
 */
function advanceToNextDraw(
  state: GameState,
  ctx: EngineContext,
  seat: PlayerId
): GameState {
  if (state.wall.length === 0) {
    return {
      ...state,
      phase: "finished",
      log: addLog(state.log, "Wall exhausted — no winner this round."),
      pendingAction: null,
    };
  }

  const [drawn, wallAfter] = drawFromWall(state.wall);
  const hand = [...state.hands[seat], drawn];
  const log = addLog(state.log, `${seat} draws.`);

  const newState: GameState = {
    ...state,
    wall: wallAfter,
    hands: { ...state.hands, [seat]: hand },
    currentSeat: seat,
    turnNumber: state.turnNumber + 1,
    log,
    pendingAction: ctx.humanSeats.has(seat) ? { type: "human_discard" } : null,
    lastDraw: { seat, tileId: drawn.id },
  };

  return newState;
}

// =============================================================================
// Joker swap helpers
// =============================================================================

/**
 * A legal joker-swap opportunity available to `swapperSeat`:
 * remove `handTile` from their hand, replace `jokerTile` in the meld with `handTile`,
 * and give the joker to the swapper.
 */
export interface JokerSwap {
  swapperSeat: PlayerId;
  meldOwnerSeat: PlayerId;
  meldIndex: number;
  jokerTile: Tile;
  handTile: Tile;
}

/** The natural suit+val a meld represents (any non-joker tile in the meld). */
function meldTarget(meld: Meld): { suit: Tile["suit"]; val: Tile["val"] } | null {
  const natural = meld.tiles.find(t => t.suit !== "joker");
  return natural ? { suit: natural.suit, val: natural.val } : null;
}

/**
 * Enumerate every legal joker swap available to `swapperSeat`. Each pair of
 * (joker in a meld, matching natural in hand) yields one entry. The UI uses
 * this to render the "Swap joker" panel; the CPU uses it to auto-swap.
 */
export function findJokerSwaps(state: GameState, swapperSeat: PlayerId): JokerSwap[] {
  const hand = state.hands[swapperSeat] ?? [];
  if (hand.length === 0) return [];

  const swaps: JokerSwap[] = [];
  for (const seat of SEAT_ORDER) {
    const melds = state.melds[seat] ?? [];
    melds.forEach((meld, meldIndex) => {
      const target = meldTarget(meld);
      if (!target) return;
      const naturalsInHand = hand.filter(t => t.suit === target.suit && t.val === target.val);
      if (naturalsInHand.length === 0) return;
      for (const jokerTile of meld.tiles) {
        if (jokerTile.suit !== "joker") continue;
        // Pair this joker with one natural — for the UI we surface every distinct
        // (joker, natural) pairing so the player can pick which natural to give up.
        for (const handTile of naturalsInHand) {
          swaps.push({
            swapperSeat,
            meldOwnerSeat: seat,
            meldIndex,
            jokerTile,
            handTile,
          });
        }
      }
    });
  }
  return swaps;
}

function validateJokerSwap(
  state: GameState,
  swapperSeat: PlayerId,
  meldOwnerSeat: PlayerId,
  meldIndex: number,
  jokerTileId: string,
  handTileId: string
): JokerSwap | null {
  const meld = state.melds[meldOwnerSeat]?.[meldIndex];
  if (!meld) return null;
  const jokerTile = meld.tiles.find(t => t.id === jokerTileId);
  if (!jokerTile || jokerTile.suit !== "joker") return null;
  const target = meldTarget(meld);
  if (!target) return null;
  const handTile = state.hands[swapperSeat]?.find(t => t.id === handTileId);
  if (!handTile) return null;
  if (handTile.suit !== target.suit || handTile.val !== target.val) return null;
  return { swapperSeat, meldOwnerSeat, meldIndex, jokerTile, handTile };
}

function applyJokerSwap(state: GameState, swap: JokerSwap): GameState {
  const { swapperSeat, meldOwnerSeat, meldIndex, jokerTile, handTile } = swap;
  const meld = state.melds[meldOwnerSeat][meldIndex];

  // Replace the joker in the meld with the natural tile (marked as a swapped-in tile).
  const newMeldTiles = meld.tiles.map(t =>
    t.id === jokerTile.id
      ? setTileState({ ...handTile }, "joker_swapped" as TileState, meldOwnerSeat)
      : t
  );
  const newMeld: Meld = { ...meld, tiles: newMeldTiles };
  const newOwnerMelds = state.melds[meldOwnerSeat].map((m, i) => (i === meldIndex ? newMeld : m));

  // Remove the natural from the swapper's hand, add the joker to it.
  const swappedJoker = setTileState({ ...jokerTile }, "in_hand" as TileState, swapperSeat);
  const newSwapperHand = [
    ...state.hands[swapperSeat].filter(t => t.id !== handTile.id),
    swappedJoker,
  ];

  return {
    ...state,
    hands: { ...state.hands, [swapperSeat]: newSwapperHand },
    melds: { ...state.melds, [meldOwnerSeat]: newOwnerMelds },
    log: addLog(
      state.log,
      `${swapperSeat} swaps for joker in ${meldOwnerSeat}'s ${meld.type}.`
    ),
  };
}

/**
 * Greedy auto-swap for CPUs: as long as there's a legal joker swap, take it.
 * A free joker is essentially always an upgrade, so we don't ask the strategy.
 */
function applyAutoJokerSwaps(state: GameState, seat: PlayerId): GameState {
  let s = state;
  // Safety bound: at most one swap per distinct joker in play.
  for (let i = 0; i < 16; i++) {
    const swaps = findJokerSwaps(s, seat);
    if (swaps.length === 0) break;
    s = applyJokerSwap(s, swaps[0]);
  }
  return s;
}

function runCpuTurn(state: GameState, ctx: EngineContext, seat: PlayerId): GameState {
  const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;

  // Take any free joker swaps before drawing-vs-discard logic.
  const stateAfterSwaps = applyAutoJokerSwaps(state, seat);
  const hand = stateAfterSwaps.hands[seat];

  // Check for self-draw mahjong (14 tiles after draw in advanceToNextDraw)
  if (hand.length === 14 && isWinningHand(hand, stateAfterSwaps.wall, ctx.patterns)) {
    return applyMahjongWin(stateAfterSwaps, ctx, seat, hand, "self_draw", null);
  }

  const evalResult = evaluateHand(hand, stateAfterSwaps.wall, ctx.patterns);
  const discardChoice = strategy.chooseDiscard(hand, evalResult, stateAfterSwaps.wall, ctx.patterns);
  return processDiscard(stateAfterSwaps, ctx, seat, discardChoice);
}
