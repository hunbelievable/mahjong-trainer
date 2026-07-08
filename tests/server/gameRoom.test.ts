import { describe, it, expect } from "vitest";
import { GameRoom, type SeatConfig } from "@/lib/server/gameRoom";
import type { PlayerId } from "@/engine/tiles";

const CPU: SeatConfig = { kind: "cpu", difficulty: "intermediate" };

function roomWithHuman(seat: PlayerId): GameRoom {
  const seats = { E: CPU, S: CPU, W: CPU, N: CPU } as Record<PlayerId, SeatConfig>;
  seats[seat] = { kind: "human", userId: "user-1" };
  return new GameRoom(seats);
}

/**
 * Drive a just-started room through its Charleston (staging 3 arbitrary
 * non-joker tiles each step, then voting to skip the Second Charleston) so
 * tests that only care about play-phase behavior don't have to hand-roll this
 * every time. Charleston itself is covered in its own describe block below.
 */
function driveCharlestonToPlay(room: GameRoom, seat: PlayerId): void {
  for (let step = 0; step < 3; step++) {
    const tiles = room.viewFor(seat).yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
    room.submit(seat, { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles });
  }
  room.submit(seat, { type: "STOP_CHARLESTON" });
}

describe("GameRoom", () => {
  it("deals and drives to the human's first turn (East acts first)", () => {
    const room = roomWithHuman("E");
    room.start();
    driveCharlestonToPlay(room, "E");
    expect(room.phase).toBe("playing");
    expect(room.waitingOn).toBe("E");           // East is human and acts first
    const view = room.viewFor("E");
    expect(view.yourHand.length).toBe(14);       // drew the 14th tile
    expect(view.pendingActionForYou).toEqual({ type: "human_discard" });
  });

  it("redacts each seat's view — you see your hand, opponents only counts", () => {
    const room = roomWithHuman("E");
    room.start();
    const eView = room.viewFor("E");
    // opponents are counts + public melds only
    expect(eView.opponents.map((o) => o.seat)).toEqual(["S", "W", "N"]);
    for (const o of eView.opponents) {
      expect(o.handCount).toBeGreaterThan(0);
      expect(o).not.toHaveProperty("hand");
    }
    // a different seat's view never contains East's concealed tiles
    const sView = room.viewFor("S");
    const eHandIds = new Set(eView.yourHand.map((t) => t.id));
    for (const t of sView.yourHand) expect(eHandIds.has(t.id)).toBe(false);
    expect(sView.wallCount).toBe(eView.wallCount); // wall count is public & identical
  });

  it("accepts a legal discard from the seat on turn and advances play", () => {
    const room = roomWithHuman("E");
    room.start();
    driveCharlestonToPlay(room, "E");
    const tile = room.viewFor("E").yourHand.find((t) => t.suit !== "joker")!;
    const ok = room.submit("E", { type: "HUMAN_DISCARD", tileId: tile.id });
    expect(ok).toBe(true);
    // East's discard is now in the concrete event log
    expect(room.events.some((e) => e.type === "discard" && e.seat === "E" && e.tileId === tile.id)).toBe(true);
    // play advanced past East — either it's East's turn again or the game moved on
    expect(room.phase === "playing" || room.phase === "finished").toBe(true);
  });

  it("rejects moves from the wrong seat or when it isn't a discard turn", () => {
    const room = roomWithHuman("E");
    room.start();
    const tile = room.viewFor("E").yourHand[0];
    // S is a CPU and it's East's turn — S cannot submit
    expect(room.submit("S", { type: "HUMAN_DISCARD", tileId: tile.id })).toBe(false);
    // a bogus tile id is rejected
    expect(room.submit("E", { type: "HUMAN_DISCARD", tileId: "not_a_real_tile" })).toBe(false);
  });

  it("rejects a joker swap from the wrong seat — same turn gate as a discard", () => {
    const room = roomWithHuman("E");
    room.start();
    // S is a CPU and it's East's turn — S cannot submit a swap either
    expect(
      room.submit("S", {
        type: "HUMAN_JOKER_SWAP",
        meldOwnerSeat: "W",
        meldIndex: 0,
        jokerTileId: "joker_joker_1",
        handTileId: "dots_1_1",
      }),
    ).toBe(false);
  });

  it("runs an all-CPU room to completion on its own", () => {
    const room = new GameRoom({ E: CPU, S: CPU, W: CPU, N: CPU });
    room.start();
    expect(room.phase).toBe("finished");
    expect(room.waitingOn).toBeNull();
    // it produced concrete discard events and ended in a win or a wall game
    expect(room.events.some((e) => e.type === "discard")).toBe(true);
    expect(room.events.some((e) => e.type === "win" || e.type === "wall_game")).toBe(true);
  });

  it("rejects HUMAN_CLAIM/HUMAN_PASS when no claim window is open", () => {
    const room = roomWithHuman("E");
    room.start(); // paused at a Charleston step, not a claim window
    expect(room.waitingOnClaim).toBeNull();
    expect(room.submit("E", { type: "HUMAN_PASS" })).toBe(false);
    expect(room.submit("E", { type: "HUMAN_CLAIM", claimType: "pung" })).toBe(false);
  });

  it("pauses on a claim window for the human instead of auto-passing, and resumes once passed", () => {
    // Claim windows depend on the random deal; drive several full games,
    // passing every claim window encountered, and require at least one game
    // to have actually hit the pause (statistically near-certain over a few
    // full 100-tile-wall games — if this ever flakes, it's a real behavior
    // regression, not bad luck).
    let sawClaimWindow = false;

    for (let attempt = 0; attempt < 5 && !sawClaimWindow; attempt++) {
      const room = roomWithHuman("E");
      room.start();
      driveCharlestonToPlay(room, "E");

      let guard = 500;
      while (room.phase === "playing" && guard-- > 0) {
        if (room.waitingOnClaim === "E") {
          sawClaimWindow = true;
          // Before submitting, confirm the pause is real: the pending action
          // is still a claim_window (drive() did not silently auto-resolve it).
          expect(room.snapshot().pendingAction?.type).toBe("claim_window");
          expect(room.submit("E", { type: "HUMAN_PASS" })).toBe(true);
        } else if (room.waitingOn === "E") {
          const tile = room.viewFor("E").yourHand.find((t) => t.suit !== "joker");
          if (!tile) break;
          room.submit("E", { type: "HUMAN_DISCARD", tileId: tile.id });
        } else {
          break; // shouldn't happen — nothing pending but not our turn either
        }
      }
      expect(room.phase === "playing" || room.phase === "finished").toBe(true);
    }

    expect(sawClaimWindow).toBe(true);
  });

  it("the discarder never sees a claim prompt for their own discard", () => {
    let found = false;
    for (let attempt = 0; attempt < 5 && !found; attempt++) {
      const room = roomWithHuman("E");
      room.start();
      driveCharlestonToPlay(room, "E");
      let guard = 500;
      while (room.phase === "playing" && guard-- > 0) {
        if (room.waitingOnClaim === "E") {
          found = true;
          const discardedBy = room.snapshot().pendingAction as { discardedBy: PlayerId };
          expect(room.viewFor(discardedBy.discardedBy).pendingActionForYou).toBeNull();
          room.submit("E", { type: "HUMAN_PASS" });
        } else if (room.waitingOn === "E") {
          const tile = room.viewFor("E").yourHand.find((t) => t.suit !== "joker");
          if (!tile) break;
          room.submit("E", { type: "HUMAN_DISCARD", tileId: tile.id });
        } else {
          break;
        }
      }
    }
    expect(found).toBe(true);
  });
});

describe("GameRoom — Charleston", () => {
  /** Pick 3 non-joker tile ids from the human's current hand. */
  function pick3(room: GameRoom, seat: PlayerId): string[] {
    return room
      .viewFor(seat)
      .yourHand.filter((t) => t.suit !== "joker")
      .slice(0, 3)
      .map((t) => t.id);
  }

  it("pauses at the human's first Charleston step instead of auto-staging", () => {
    const room = roomWithHuman("E");
    room.start();
    expect(room.phase).toBe("charleston");
    expect(room.waitingOnCharleston).toBe("E");
    expect(room.snapshot().pendingAction).toEqual({ type: "human_charleston_pass", step: 0 });
    // 13 tiles dealt, none staged away yet — proves this wasn't auto-resolved.
    expect(room.viewFor("E").yourHand).toHaveLength(13);
  });

  it("rejects a stage from the wrong seat, and a non-3-tile selection", () => {
    const room = roomWithHuman("E");
    room.start();
    const tiles = pick3(room, "E");
    expect(room.submit("S", { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles })).toBe(false);
    expect(room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles.slice(0, 2) })).toBe(false);
    // still paused at step 0 — neither rejected attempt mutated state
    expect(room.snapshot().pendingAction).toEqual({ type: "human_charleston_pass", step: 0 });
  });

  it("staging 3 real tiles advances to the next Charleston step", () => {
    const room = roomWithHuman("E");
    room.start();
    const tiles = pick3(room, "E");
    expect(room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles })).toBe(true);
    expect(room.phase).toBe("charleston");
    expect(room.snapshot().pendingAction).toEqual({ type: "human_charleston_pass", step: 1 });
    // the 3 passed tiles are gone, replaced by 3 received ones — still 13
    expect(room.viewFor("E").yourHand).toHaveLength(13);
  });

  it("driving through all three First Charleston steps reaches the stop vote, and skipping reaches play", () => {
    const room = roomWithHuman("E");
    room.start();
    for (let step = 0; step < 3; step++) {
      expect(room.waitingOnCharleston).toBe("E");
      room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: pick3(room, "E") });
    }
    expect(room.snapshot().pendingAction?.type).toBe("human_charleston_stop");
    expect(room.waitingOnCharleston).toBe("E");

    expect(room.submit("E", { type: "STOP_CHARLESTON" })).toBe(true);
    expect(room.phase).toBe("playing");
    expect(room.waitingOn).toBe("E"); // East acts first once play begins
  });

  it("choosing to play the Second Charleston continues into 3 more staging steps", () => {
    const room = roomWithHuman("E");
    room.start();
    for (let step = 0; step < 3; step++) {
      room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: pick3(room, "E") });
    }
    expect(room.submit("E", { type: "BEGIN_SECOND_CHARLESTON" })).toBe(true);
    expect(room.phase).toBe("charleston");
    expect(room.snapshot().pendingAction).toEqual({ type: "human_charleston_pass", step: 3 });
    expect(room.waitingOnCharleston).toBe("E");
  });

  it("rejects STOP_CHARLESTON/BEGIN_SECOND_CHARLESTON when no stop vote is open", () => {
    const room = roomWithHuman("E");
    room.start(); // paused at step 0's tile-staging, not the stop vote
    expect(room.submit("E", { type: "STOP_CHARLESTON" })).toBe(false);
    expect(room.submit("E", { type: "BEGIN_SECOND_CHARLESTON" })).toBe(false);
  });
});
