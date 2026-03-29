import { generateWall, tileId } from "@/engine/tiles";
import type { Tile, TileState, Suit, TileVal, PlayerId } from "@/engine/tiles";

// =============================================================================
// State
// =============================================================================

export interface LiveGameState {
  /**
   * Master tile registry — immutably updated as tiles change state.
   * Each action creates a new Map with updated tile objects.
   */
  registry: Map<string, Tile>;

  /** IDs of tiles currently in the user's hand (ordered). */
  handIds: string[];

  /** IDs of discarded tiles per player (ordered, oldest first). */
  discardIds: Record<PlayerId, string[]>;

  /** Which seat the user is playing. */
  myPosition: PlayerId;
}

// =============================================================================
// Actions
// =============================================================================

export type LiveGameAction =
  | { type: "ADD_TO_HAND";      suit: Suit; val: TileVal }
  | { type: "REMOVE_FROM_HAND"; tileId: string }
  | { type: "DISCARD";          tileId: string; player: PlayerId }
  | { type: "ADD_DISCARD";      suit: Suit; val: TileVal; player: PlayerId }
  | { type: "REMOVE_DISCARD";   tileId: string; player: PlayerId }
  | { type: "RESET" };

// =============================================================================
// Initialization
// =============================================================================

export function createInitialState(myPosition: PlayerId = "E"): LiveGameState {
  const wall = generateWall();
  const registry = new Map<string, Tile>();
  for (const tile of wall) {
    registry.set(tile.id, tile);
  }
  return {
    registry,
    handIds: [],
    discardIds: { E: [], S: [], W: [], N: [] },
    myPosition,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Find the ID of the next available (in_wall) copy of a tile type.
 * Pure — reads only, does not mutate anything.
 */
function findAvailableId(
  registry: Map<string, Tile>,
  suit: Suit,
  val: TileVal
): string | null {
  const maxCopies = suit === "flower" || suit === "joker" ? 8 : 4;
  for (let copy = 1; copy <= maxCopies; copy++) {
    const id = tileId(suit, val, copy);
    const tile = registry.get(id);
    if (tile && tile.state === "in_wall") return id;
  }
  return null;
}

/**
 * Return a new registry Map with one tile's state/owner updated.
 * Never mutates the existing Map or Tile objects.
 */
function updateTile(
  registry: Map<string, Tile>,
  id: string,
  patch: Partial<Pick<Tile, "state" | "owner">>
): Map<string, Tile> {
  const existing = registry.get(id);
  if (!existing) return registry;
  const next = new Map(registry);
  next.set(id, { ...existing, ...patch });
  return next;
}

/** Derive an ordered Tile[] from a list of IDs via the registry. */
export function tilesFromIds(state: LiveGameState, ids: string[]): Tile[] {
  return ids.map(id => state.registry.get(id)!).filter(Boolean);
}

/**
 * Build the wall array for the evaluator.
 * The evaluator's getLiveWall() filters by state === 'in_wall', so passing the
 * full registry gives it accurate dead-tile information.
 */
export function buildEvalWall(state: LiveGameState): Tile[] {
  return Array.from(state.registry.values());
}

// =============================================================================
// Reducer — fully pure, no mutations
// =============================================================================

export function liveGameReducer(
  state: LiveGameState,
  action: LiveGameAction
): LiveGameState {
  switch (action.type) {

    case "ADD_TO_HAND": {
      if (state.handIds.length >= 14) return state;
      const id = findAvailableId(state.registry, action.suit, action.val);
      if (!id) return state;
      return {
        ...state,
        registry: updateTile(state.registry, id, { state: "in_hand", owner: state.myPosition }),
        handIds: [...state.handIds, id],
      };
    }

    case "REMOVE_FROM_HAND": {
      if (!state.registry.has(action.tileId)) return state;
      return {
        ...state,
        registry: updateTile(state.registry, action.tileId, { state: "in_wall", owner: null }),
        handIds: state.handIds.filter(id => id !== action.tileId),
      };
    }

    case "DISCARD": {
      if (!state.registry.has(action.tileId)) return state;
      return {
        ...state,
        registry: updateTile(state.registry, action.tileId, { state: "discarded", owner: action.player }),
        handIds: state.handIds.filter(id => id !== action.tileId),
        discardIds: {
          ...state.discardIds,
          [action.player]: [...state.discardIds[action.player], action.tileId],
        },
      };
    }

    case "ADD_DISCARD": {
      const id = findAvailableId(state.registry, action.suit, action.val);
      if (!id) return state;
      return {
        ...state,
        registry: updateTile(state.registry, id, { state: "discarded", owner: action.player }),
        discardIds: {
          ...state.discardIds,
          [action.player]: [...state.discardIds[action.player], id],
        },
      };
    }

    case "REMOVE_DISCARD": {
      if (!state.registry.has(action.tileId)) return state;
      return {
        ...state,
        registry: updateTile(state.registry, action.tileId, { state: "in_wall", owner: null }),
        discardIds: {
          ...state.discardIds,
          [action.player]: state.discardIds[action.player].filter(
            id => id !== action.tileId
          ),
        },
      };
    }

    case "RESET":
      return createInitialState(state.myPosition);

    default:
      return state;
  }
}
