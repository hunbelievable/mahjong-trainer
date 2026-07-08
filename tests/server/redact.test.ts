import { describe, it, expect } from "vitest";
import { redactStateForSeat, tileIdsInView } from "@/lib/server/redact";
import type { GameState, Meld } from "@/engine/gameEngine";
import { tileId } from "@/engine/tiles";
import type { Tile, Suit, TileVal, PlayerId } from "@/engine/tiles";

// ---------------------------------------------------------------------------
// Fixtures — a state with clearly distinct tiles per seat so leaks are obvious.
// ---------------------------------------------------------------------------

function mk(suit: Suit, val: TileVal, copy = 1, owner: PlayerId | null = null): Tile {
  return { id: tileId(suit, val, copy), suit, val, copyIndex: copy, state: "in_hand", owner, history: [] };
}

const E_HAND = [mk("dots", 1, 1, "E"), mk("dots", 2, 1, "E"), mk("dots", 3, 1, "E")];
const S_HAND = [mk("bams", 1, 1, "S"), mk("bams", 2, 1, "S")];
const W_HAND = [mk("cracks", 1, 1, "W"), mk("cracks", 2, 1, "W"), mk("cracks", 3, 1, "W")];
const N_HAND = [mk("dragon", "red", 1, "N"), mk("dragon", "green", 1, "N")];

const S_MELD: Meld = { type: "pung", tiles: [mk("bams", 9, 1), mk("bams", 9, 2), mk("bams", 9, 3)], claimedFrom: "E" };

const WALL = [mk("dots", 5, 1), mk("bams", 5, 1), mk("cracks", 5, 1), mk("dragon", "white", 1)];

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: "playing",
    wall: WALL,
    hands: { E: E_HAND, S: S_HAND, W: W_HAND, N: N_HAND },
    melds: { E: [], S: [S_MELD], W: [], N: [] },
    discardPile: { E: [mk("dots", 9, 1)], S: [], W: [mk("cracks", 8, 1)], N: [] },
    currentSeat: "E",
    lastDiscard: mk("cracks", 8, 1),
    turnNumber: 7,
    winner: null,
    winningPattern: null,
    pendingAction: { type: "human_discard" },
    log: ["E draws.", "W discards 8c"],
    charleston: null,
    courtesy: null,
    lastDraw: { seat: "E", tileId: tileId("dots", 3, 1) },
    ...overrides,
  };
}

describe("redactStateForSeat", () => {
  it("gives the viewer their own full hand and melds", () => {
    const view = redactStateForSeat(makeState(), "E");
    expect(view.yourHand.map((t) => t.id)).toEqual(E_HAND.map((t) => t.id));
    expect(view.you).toBe("E");
  });

  it("shows opponents only as counts + public melds (no concealed tiles)", () => {
    const view = redactStateForSeat(makeState(), "E");
    const opp = Object.fromEntries(view.opponents.map((o) => [o.seat, o]));
    expect(view.opponents.map((o) => o.seat)).toEqual(["S", "W", "N"]);
    expect(opp.S.handCount).toBe(S_HAND.length);
    expect(opp.W.handCount).toBe(W_HAND.length);
    expect(opp.N.handCount).toBe(N_HAND.length);
    // exposed melds are public
    expect(opp.S.melds).toEqual([S_MELD]);
    // OpponentView has no field carrying concealed tiles
    expect(opp.S).not.toHaveProperty("hand");
    expect(opp.S).not.toHaveProperty("tiles");
  });

  it("NEVER leaks a concealed opponent tile or any wall tile", () => {
    const state = makeState();
    for (const seat of ["E", "S", "W", "N"] as PlayerId[]) {
      const view = redactStateForSeat(state, seat);
      const shown = tileIdsInView(view);

      // Other seats' concealed hands must not appear
      for (const other of ["E", "S", "W", "N"] as PlayerId[]) {
        if (other === seat) continue;
        for (const t of state.hands[other]) {
          expect(shown.has(t.id)).toBe(false);
        }
      }
      // Wall contents must never appear
      for (const t of state.wall) {
        expect(shown.has(t.id)).toBe(false);
      }
    }
  });

  it("exposes the wall as a count only", () => {
    const view = redactStateForSeat(makeState(), "S");
    expect(view.wallCount).toBe(WALL.length);
    expect((view as unknown as Record<string, unknown>).wall).toBeUndefined();
  });

  it("reveals a fresh-draw tile id only to the seat that drew it", () => {
    const state = makeState({ lastDraw: { seat: "E", tileId: tileId("dots", 3, 1) } });
    expect(redactStateForSeat(state, "E").yourFreshTileId).toBe(tileId("dots", 3, 1));
    expect(redactStateForSeat(state, "S").yourFreshTileId).toBeNull();
    // but everyone can see *that* East drew
    expect(redactStateForSeat(state, "S").lastDrawSeat).toBe("E");
  });

  it("addresses human_discard only to the seat whose turn it is", () => {
    const state = makeState({ currentSeat: "W", pendingAction: { type: "human_discard" } });
    expect(redactStateForSeat(state, "W").pendingActionForYou).toEqual({ type: "human_discard" });
    expect(redactStateForSeat(state, "E").pendingActionForYou).toBeNull();
  });

  it("addresses a claim window to potential claimers, not the discarder", () => {
    const discard = mk("cracks", 8, 1);
    const state = makeState({
      pendingAction: { type: "claim_window", discard, discardedBy: "E", eligibleTypes: ["pung"] },
    });
    expect(redactStateForSeat(state, "E").pendingActionForYou).toBeNull(); // discarder can't claim
    expect(redactStateForSeat(state, "S").pendingActionForYou).toMatchObject({ type: "claim_window" });
  });

  it("does not mutate the input state", () => {
    const state = makeState();
    const snapshot = JSON.stringify(state);
    redactStateForSeat(state, "E");
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
