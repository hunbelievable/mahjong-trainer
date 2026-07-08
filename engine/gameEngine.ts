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
      eligibleTypes: ClaimType[]; // types the human CAN claim (mahjong first)
    }
  | { type: "human_charleston_pass"; step: number }
  | {
      type: "human_charleston_stop";
      /** CPU votes so the UI can show how each opponent voted. true = wants to stop. */
      cpuVotes: Record<PlayerId, boolean>;
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
  | { type: "HUMAN_CLAIM"; claimType: ClaimType }
  | { type: "HUMAN_PASS" }
  | { type: "HUMAN_STAGE_CHARLESTON"; tileIds: string[] }
  | { type: "STOP_CHARLESTON" }
  | { type: "BEGIN_SECOND_CHARLESTON" }
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
  | { type: "RESET" };

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

      return {
        ...newState,
        pendingAction: { type: "human_charleston_pass", step: 0 },
      };
    }

    // ── HUMAN_STAGE_CHARLESTON ─────────────────────────────────────────────
    case "HUMAN_STAGE_CHARLESTON": {
      if (state.pendingAction?.type !== "human_charleston_pass") return state;
      if (!state.charleston) return state;

      const { tileIds } = action;
      if (tileIds.length !== 3) return state;

      const humanHand = state.hands[ctx.humanSeat];
      const tiles = tileIds.map(id => humanHand.find(t => t.id === id)).filter(Boolean) as Tile[];
      if (tiles.length !== 3) return state;
      if (tiles.some(t => t.suit === "joker")) return state;

      const step = state.charleston.step;
      const stagedWithHuman: CharlestonState = {
        ...state.charleston,
        staged: { ...state.charleston.staged, [ctx.humanSeat]: tileIds },
      };

      // Execute the exchange
      let newState = executeCharleston({ ...state, charleston: stagedWithHuman }, step);
      const nextStep = step + 1;

      // After First Charleston (steps 0–2): vote on whether to play the Second.
      // NMJL rule: Second Charleston is *skipped* only if ALL four players agree to
      // skip. If any player wants to play it, it happens.
      if (nextStep === 3) {
        const cpuSeats = SEAT_ORDER.filter(s => s !== ctx.humanSeat);
        const cpuVotes: Record<PlayerId, boolean> = { E: false, S: false, W: false, N: false };
        for (const seat of cpuSeats) {
          const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
          cpuVotes[seat] = shouldStopCharleston(strategy, newState.hands[seat], newState.wall, ctx.patterns);
        }

        return {
          ...newState,
          charleston: { ...newState.charleston!, step: nextStep, staged: {} },
          pendingAction: { type: "human_charleston_stop", cpuVotes },
        };
      }

      // After all 6 steps — Second Charleston was played, so begin courtesy phase
      if (nextStep > 5) {
        return startCourtesyOrFinish(
          addLog(newState.log, "Charleston complete."),
          newState,
          ctx,
          /* hadSecond */ true
        );
      }

      // Advance to next step: CPUs stage, then wait for human
      newState = { ...newState, charleston: { ...newState.charleston!, step: nextStep, staged: {} } };
      newState = cpuStageCharleston(newState, ctx, nextStep);
      return {
        ...newState,
        pendingAction: { type: "human_charleston_pass", step: nextStep },
      };
    }

    // ── STOP_CHARLESTON ───────────────────────────────────────────────────
    // Any single vote to skip ends the Second Charleston (common house rule).
    case "STOP_CHARLESTON": {
      if (state.pendingAction?.type !== "human_charleston_stop") return state;
      return startCourtesyOrFinish(
        addLog(state.log, `${ctx.humanSeat} votes to skip — Second Charleston ends.`),
        state,
        ctx,
        /* hadSecond */ false
      );
    }

    // ── BEGIN_SECOND_CHARLESTON ───────────────────────────────────────────
    // Honored only if no CPU has already voted to skip. If any CPU wants to skip,
    // the Second Charleston is canceled even when the human wants to play.
    case "BEGIN_SECOND_CHARLESTON": {
      if (state.pendingAction?.type !== "human_charleston_stop") return state;
      const { cpuVotes } = state.pendingAction;
      const cpuStopper = SEAT_ORDER
        .filter(s => s !== ctx.humanSeat)
        .find(s => cpuVotes[s]);
      if (cpuStopper) {
        return startCourtesyOrFinish(
          addLog(state.log, `${cpuStopper} votes to skip — Second Charleston ends.`),
          state,
          ctx,
          /* hadSecond */ false
        );
      }
      let newState: GameState = {
        ...state,
        charleston: { ...state.charleston!, step: 3, staged: {} },
        log: addLog(state.log, "Second Charleston begins."),
      };
      newState = cpuStageCharleston(newState, ctx, 3);
      return {
        ...newState,
        pendingAction: { type: "human_charleston_pass", step: 3 },
      };
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
    // Swap a natural tile from the human's hand for a joker in any exposed meld.
    // Legal only while the human is between draw/claim and discard (pendingAction === human_discard).
    case "HUMAN_JOKER_SWAP": {
      if (state.pendingAction?.type !== "human_discard") return state;
      const swap = validateJokerSwap(
        state,
        ctx.humanSeat,
        action.meldOwnerSeat,
        action.meldIndex,
        action.jokerTileId,
        action.handTileId
      );
      if (!swap) return state;
      return applyJokerSwap(state, swap);
    }

    // ── HUMAN_CLAIM ───────────────────────────────────────────────────────────
    case "HUMAN_CLAIM": {
      if (state.pendingAction?.type !== "claim_window") return state;
      const { discard, discardedBy } = state.pendingAction;

      if (action.claimType === "mahjong") {
        const hand = state.hands[ctx.humanSeat];
        return {
          ...state,
          winner: ctx.humanSeat,
          winningPattern: evaluateHand([...hand, discard], state.wall, ctx.patterns).bestPatterns[0]?.pattern ?? null,
          phase: "finished",
          pendingAction: null,
          log: addLog(state.log, `${ctx.humanSeat} declares MAHJONG!`),
        };
      }

      return processClaim(state, ctx, ctx.humanSeat, discard, discardedBy, action.claimType);
    }

    // ── HUMAN_PASS ────────────────────────────────────────────────────────────
    case "HUMAN_PASS": {
      if (state.pendingAction?.type !== "claim_window") return state;
      const { discard, discardedBy } = state.pendingAction;

      // Human passes — check if any CPU wants to claim
      return resolveCpuClaims(state, ctx, discard, discardedBy, ctx.humanSeat);
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
            s = gameReducer(s, { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles.map(t => t.id) }, ctx);
          } else if (s.pendingAction?.type === "human_charleston_stop") {
            s = gameReducer(s, { type: "BEGIN_SECOND_CHARLESTON" }, ctx);
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
            s = gameReducer(s, { type: "HUMAN_PASS" }, ctx);
          } else {
            break;
          }
        }
      }
      return s;
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

/** Have every CPU seat stage their 3 tiles for `step`. */
function cpuStageCharleston(state: GameState, ctx: EngineContext, step: number): GameState {
  const staged = { ...(state.charleston?.staged ?? {}) };

  for (const seat of SEAT_ORDER) {
    if (seat === ctx.humanSeat) continue;
    const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
    const tiles = chooseTilesForCharleston(strategy, state.hands[seat], state.wall, ctx.patterns);
    staged[seat] = tiles.map(t => t.id);
  }

  return { ...state, charleston: { ...state.charleston!, staged } };
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
 * Open a claim window. Returns a state with either:
 * - pendingAction: { type: 'claim_window' } if the human can claim
 * - or immediately resolves CPU claims and advances the turn
 */
function openClaimWindow(
  state: GameState,
  ctx: EngineContext,
  discard: Tile,
  discardedBy: PlayerId
): GameState {
  const others = SEAT_ORDER.filter(s => s !== discardedBy);

  // Human claim opportunity — check first (guard against invalid humanSeat in tests)
  const humanHand = state.hands[ctx.humanSeat];
  const humanEligible =
    humanHand && ctx.humanSeat !== discardedBy
      ? eligibleClaims(discard, humanHand, state.wall, ctx.patterns)
      : [];

  if (humanEligible.length > 0) {
    return {
      ...state,
      pendingAction: {
        type: "claim_window",
        discard,
        discardedBy,
        eligibleTypes: humanEligible,
      },
    };
  }

  // No human claim — resolve CPU claims immediately
  return resolveCpuClaims(state, ctx, discard, discardedBy, null);
}

/**
 * Resolve CPU claim decisions. If any CPU claims, process it and return.
 * If no one claims, advance to next player's draw.
 */
function resolveCpuClaims(
  state: GameState,
  ctx: EngineContext,
  discard: Tile,
  discardedBy: PlayerId,
  humanAlreadyPassed: PlayerId | null
): GameState {
  const cpuSeats = SEAT_ORDER.filter(
    s => s !== discardedBy && s !== humanAlreadyPassed && !ctx.humanSeats.has(s)
  );

  // Check mahjong claims first across all CPUs
  for (const seat of cpuSeats) {
    const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
    if (strategy.shouldClaim(discard, state.hands[seat], "mahjong", state.wall, ctx.patterns)) {
      const hand = state.hands[seat];
      return {
        ...state,
        winner: seat,
        winningPattern:
          evaluateHand([...hand, discard], state.wall, ctx.patterns).bestPatterns[0]?.pattern ?? null,
        phase: "finished",
        pendingAction: null,
        log: addLog(state.log, `${seat} declares MAHJONG!`),
      };
    }
  }

  // Shuffle eligible CPUs for random claim priority among non-mahjong
  const shuffledCpus = [...cpuSeats].sort(() => Math.random() - 0.5);
  for (const seat of shuffledCpus) {
    const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
    for (const claimType of ["quint", "kong", "pung"] as ("pung" | "kong" | "quint")[]) {
      if (strategy.shouldClaim(discard, state.hands[seat], claimType, state.wall, ctx.patterns)) {
        return processClaim(state, ctx, seat, discard, discardedBy, claimType);
      }
    }
  }

  // No claims — advance to next player's draw turn
  return advanceToNextDraw(state, ctx, nextSeat(discardedBy));
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
    return {
      ...stateAfterSwaps,
      winner: seat,
      winningPattern:
        evaluateHand(hand, stateAfterSwaps.wall, ctx.patterns).bestPatterns[0]?.pattern ?? null,
      phase: "finished",
      pendingAction: null,
      log: addLog(stateAfterSwaps.log, `${seat} self-draws MAHJONG!`),
    };
  }

  const evalResult = evaluateHand(hand, stateAfterSwaps.wall, ctx.patterns);
  const discardChoice = strategy.chooseDiscard(hand, evalResult, stateAfterSwaps.wall, ctx.patterns);
  return processDiscard(stateAfterSwaps, ctx, seat, discardChoice);
}
