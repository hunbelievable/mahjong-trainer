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
import { DIFFICULTY_PRESETS, chooseTilesForCharleston, shouldStopCharleston } from "./cpu";

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
  | { type: "human_charleston_stop" };

export type GamePhase = "setup" | "charleston" | "playing" | "finished";

// =============================================================================
// Charleston state
// =============================================================================

export interface CharlestonState {
  /** Current step: 0=FirstRight, 1=FirstAcross, 2=FirstLeft, 3=SecondLeft, 4=SecondAcross, 5=SecondRight */
  step: number;
  /** Tile IDs each player has staged to pass this step (CPUs stage immediately, human via action). */
  staged: Partial<Record<PlayerId, string[]>>;
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
const PASSES_TO: Record<"right" | "across" | "left", Record<PlayerId, PlayerId>> = {
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
  const types: ClaimType[] = [];

  // Mahjong: adding this tile completes the hand
  if (isWinningHand([...hand, discard], wall, patterns)) {
    types.push("mahjong");
  }

  const matching = hand.filter(t => t.suit === discard.suit && t.val === discard.val).length;

  // Quint (4 naturals + joker already in hand, or 4 matching)
  const jokers = hand.filter(t => t.suit === "joker").length;
  if (matching + jokers >= 4 || matching >= 4) types.push("quint");

  // Kong (3 matching)
  if (matching >= 3) types.push("kong");

  // Pung (2 matching)
  if (matching >= 2) types.push("pung");

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
  humanSeat: PlayerId;
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
        charleston: { step: 0, staged: {} },
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
        step,
        staged: { ...state.charleston.staged, [ctx.humanSeat]: tileIds },
      };

      // Execute the exchange
      let newState = executeCharleston({ ...state, charleston: stagedWithHuman }, step);
      const nextStep = step + 1;

      // After First Charleston (steps 0–2): check for Second Charleston
      if (nextStep === 3) {
        const cpuSeats = SEAT_ORDER.filter(s => s !== ctx.humanSeat);
        const stoppingSeat = cpuSeats.find(seat => {
          const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
          return shouldStopCharleston(strategy, newState.hands[seat], newState.wall, ctx.patterns);
        });

        if (stoppingSeat) {
          return finishCharleston(
            addLog(newState.log, `${stoppingSeat} stops the Second Charleston.`),
            newState,
            ctx
          );
        }

        // Ask human to continue or stop
        return {
          ...newState,
          charleston: { step: nextStep, staged: {} },
          pendingAction: { type: "human_charleston_stop" },
        };
      }

      // After all 6 steps — done
      if (nextStep > 5) {
        return finishCharleston(
          addLog(newState.log, "Charleston complete."),
          newState,
          ctx
        );
      }

      // Advance to next step: CPUs stage, then wait for human
      newState = { ...newState, charleston: { step: nextStep, staged: {} } };
      newState = cpuStageCharleston(newState, ctx, nextStep);
      return {
        ...newState,
        pendingAction: { type: "human_charleston_pass", step: nextStep },
      };
    }

    // ── STOP_CHARLESTON ───────────────────────────────────────────────────
    case "STOP_CHARLESTON": {
      if (state.pendingAction?.type !== "human_charleston_stop") return state;
      return finishCharleston(
        addLog(state.log, "Second Charleston skipped."),
        state,
        ctx
      );
    }

    // ── BEGIN_SECOND_CHARLESTON ───────────────────────────────────────────
    case "BEGIN_SECOND_CHARLESTON": {
      if (state.pendingAction?.type !== "human_charleston_stop") return state;
      let newState: GameState = {
        ...state,
        charleston: { step: 3, staged: {} },
        log: addLog(state.log, "Second Charleston begins."),
      };
      newState = cpuStageCharleston(newState, ctx, 3);
      return {
        ...newState,
        pendingAction: { type: "human_charleston_pass", step: 3 },
      };
    }

    // ── HUMAN_DISCARD ─────────────────────────────────────────────────────────
    case "HUMAN_DISCARD": {
      if (state.pendingAction?.type !== "human_discard") return state;
      const tile = state.hands[ctx.humanSeat].find(t => t.id === action.tileId);
      if (!tile) return state;

      return processDiscard(state, ctx, ctx.humanSeat, tile);
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
      if (seat === ctx.humanSeat) return state; // not a CPU seat

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
  }

  const { label, charleston: charlNum } = CHARLESTON_STEPS[step];
  return {
    ...state,
    hands: newHands,
    charleston: { ...state.charleston!, staged: {} },
    log: addLog(state.log, `Charleston ${charlNum}: ${label} complete.`),
  };
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
    pendingAction: ctx.humanSeat === "E" ? { type: "human_discard" } : null,
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
    s => s !== discardedBy && s !== humanAlreadyPassed && s !== ctx.humanSeat
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
    for (const claimType of ["quint", "kong", "pung"] as ClaimType[]) {
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
  claimType: ClaimType
): GameState {
  const needed = claimType === "pung" ? 2 : claimType === "kong" ? 3 : 4;
  const hand = state.hands[claimant];
  const matchingInHand = hand
    .filter(t => t.suit === discard.suit && t.val === discard.val)
    .slice(0, needed);

  const claimedDiscard = setTileState(discard, `claimed_${claimType}` as TileState, claimant);
  const meldTiles = [
    claimedDiscard,
    ...matchingInHand.map(t => setTileState(t, `claimed_${claimType}` as TileState, claimant)),
  ];
  const meld: Meld = { type: claimType, tiles: meldTiles, claimedFrom: discardedBy };
  const handAfterClaim = hand.filter(t => !matchingInHand.includes(t));

  let newState: GameState = {
    ...state,
    hands: { ...state.hands, [claimant]: handAfterClaim },
    melds: { ...state.melds, [claimant]: [...state.melds[claimant], meld] },
    currentSeat: claimant,
    log: addLog(state.log, `${claimant} claims ${tileLabel(discard)} for ${claimType}`),
    pendingAction: null,
  };

  // Claimant must now discard
  if (claimant === ctx.humanSeat) {
    return { ...newState, pendingAction: { type: "human_discard" } };
  }

  // CPU claimant discards immediately
  const strategy = ctx.strategies[claimant] ?? DIFFICULTY_PRESETS.intermediate;
  const evalResult = evaluateHand([...handAfterClaim, discard], newState.wall, ctx.patterns);
  const discardChoice = strategy.chooseDiscard([...handAfterClaim, discard], evalResult, newState.wall, ctx.patterns);
  return processDiscard(newState, ctx, claimant, discardChoice);
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
    pendingAction: seat === ctx.humanSeat ? { type: "human_discard" } : null,
  };

  return newState;
}

function runCpuTurn(state: GameState, ctx: EngineContext, seat: PlayerId): GameState {
  const strategy = ctx.strategies[seat] ?? DIFFICULTY_PRESETS.intermediate;
  const hand = state.hands[seat];

  // Check for self-draw mahjong (14 tiles after draw in advanceToNextDraw)
  if (hand.length === 14 && isWinningHand(hand, state.wall, ctx.patterns)) {
    return {
      ...state,
      winner: seat,
      winningPattern:
        evaluateHand(hand, state.wall, ctx.patterns).bestPatterns[0]?.pattern ?? null,
      phase: "finished",
      pendingAction: null,
      log: addLog(state.log, `${seat} self-draws MAHJONG!`),
    };
  }

  const evalResult = evaluateHand(hand, state.wall, ctx.patterns);
  const discardChoice = strategy.chooseDiscard(hand, evalResult, state.wall, ctx.patterns);
  return processDiscard(state, ctx, seat, discardChoice);
}
