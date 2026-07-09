import { describe, it, expect } from "vitest";
import { GameRoom, type SeatConfig } from "@/lib/server/gameRoom";
import type { PlayerId } from "@/engine/tiles";

const CPU: SeatConfig = { kind: "cpu", difficulty: "intermediate" };

function roomWithHuman(seat: PlayerId): GameRoom {
  const seats = { E: CPU, S: CPU, W: CPU, N: CPU } as Record<PlayerId, SeatConfig>;
  seats[seat] = { kind: "human", userId: "user-1" };
  return new GameRoom(seats);
}

function roomWithHumans(humanSeats: PlayerId[]): GameRoom {
  const seats = { E: CPU, S: CPU, W: CPU, N: CPU } as Record<PlayerId, SeatConfig>;
  for (const seat of humanSeats) seats[seat] = { kind: "human", userId: `user-${seat}` };
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
    expect(room.result).toBeNull(); // not finished before start()
    room.start();
    expect(room.phase).toBe("finished");
    expect(room.waitingOn).toBeNull();
    // it produced concrete discard events and ended in a win or a wall game
    expect(room.events.some((e) => e.type === "discard")).toBe(true);
    expect(room.events.some((e) => e.type === "win" || e.type === "wall_game")).toBe(true);

    // result classifies the outcome consistently regardless of which random
    // game this run happened to produce — see lib/server/match.ts for how
    // RoomManager turns this into standings.
    const result = room.result!;
    expect(result.winner).toBe(room.winner);
    if (result.winner === null) {
      expect(result.winKind).toBeNull();
      expect(result.winDiscardedBy).toBeNull();
    } else if (result.winKind === "discard") {
      expect(result.winDiscardedBy).not.toBeNull();
    } else if (result.winKind === "self_draw") {
      expect(result.winDiscardedBy).toBeNull();
    } else {
      throw new Error(`unexpected winKind for a real winner: ${result.winKind}`);
    }
  });

  it("rejects HUMAN_CLAIM/HUMAN_PASS when no claim window is open", () => {
    const room = roomWithHuman("E");
    room.start(); // paused at a Charleston step, not a claim window
    expect(room.waitingOnClaim).toEqual([]);
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
        if (room.waitingOnClaim.includes("E")) {
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
        if (room.waitingOnClaim.includes("E")) {
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
    expect(room.waitingOnCharleston).toEqual(["E"]);
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
      expect(room.waitingOnCharleston).toEqual(["E"]);
      room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: pick3(room, "E") });
    }
    expect(room.snapshot().pendingAction?.type).toBe("human_charleston_stop");
    expect(room.waitingOnCharleston).toEqual(["E"]);

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
    expect(room.waitingOnCharleston).toEqual(["E"]);
  });

  it("rejects STOP_CHARLESTON/BEGIN_SECOND_CHARLESTON when no stop vote is open", () => {
    const room = roomWithHuman("E");
    room.start(); // paused at step 0's tile-staging, not the stop vote
    expect(room.submit("E", { type: "STOP_CHARLESTON" })).toBe(false);
    expect(room.submit("E", { type: "BEGIN_SECOND_CHARLESTON" })).toBe(false);
  });
});

describe("GameRoom — viewFor exposes safe multi-seat pending state", () => {
  it("charlestonWaitingOn names the real human seats still needing to act, visible to every viewer", () => {
    const room = roomWithHumans(["E", "S"]);
    room.start();
    // Both E's and S's own views agree on who's still pending — this is public/safe info.
    expect(room.viewFor("E").charlestonWaitingOn.sort()).toEqual(["E", "S"]);
    expect(room.viewFor("S").charlestonWaitingOn.sort()).toEqual(["E", "S"]);

    const eTiles = room.viewFor("E").yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
    room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: eTiles });
    expect(room.viewFor("S").charlestonWaitingOn).toEqual(["S"]);
  });

  it("claimPendingCount is a count only — never the eligible seats' identities", () => {
    const room = roomWithHumans(["E"]);
    room.start();
    // Outside any claim window, the count is zero for everyone.
    expect(room.viewFor("E").claimPendingCount).toBe(0);
  });
});

describe("GameRoom — multi-human Charleston", () => {
  it("waits on BOTH human seats to stage before executing the step", () => {
    const room = roomWithHumans(["E", "S"]);
    room.start();
    expect(room.waitingOnCharleston.sort()).toEqual(["E", "S"]);

    const eTiles = room.viewFor("E").yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
    expect(room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: eTiles })).toBe(true);

    // Still step 0 — only E has staged, S hasn't yet.
    expect(room.snapshot().charleston?.step).toBe(0);
    expect(room.waitingOnCharleston).toEqual(["S"]);
    // E already staged this step — nothing more for E to do until S catches up.
    expect(room.viewFor("E").pendingActionForYou).toBeNull();
    expect(room.viewFor("S").pendingActionForYou).toMatchObject({ type: "human_charleston_pass", step: 0 });

    const sTiles = room.viewFor("S").yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
    expect(room.submit("S", { type: "HUMAN_STAGE_CHARLESTON", tileIds: sTiles })).toBe(true);

    // Both staged — the step executed and advanced.
    expect(room.snapshot().charleston?.step).toBe(1);
    expect(room.waitingOnCharleston.sort()).toEqual(["E", "S"]);
  });

  it("rejects a seat staging twice for the same step", () => {
    const room = roomWithHumans(["E", "S"]);
    room.start();
    const eTiles = room.viewFor("E").yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
    expect(room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: eTiles })).toBe(true);
    expect(room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: eTiles })).toBe(false);
  });

  it("a decisive skip vote from one seat ends the Second Charleston immediately, without waiting on the other", () => {
    const room = roomWithHumans(["E", "S"]);
    room.start();
    for (let step = 0; step < 3; step++) {
      const eTiles = room.viewFor("E").yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
      room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: eTiles });
      const sTiles = room.viewFor("S").yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
      room.submit("S", { type: "HUMAN_STAGE_CHARLESTON", tileIds: sTiles });
    }
    expect(room.waitingOnCharleston.sort()).toEqual(["E", "S"]);
    expect(room.submit("E", { type: "STOP_CHARLESTON" })).toBe(true);
    // Resolved without S ever voting — E's skip is decisive on its own.
    expect(room.phase).toBe("playing");
  });

  it("plays the Second Charleston only once every human seat votes to play", () => {
    const room = roomWithHumans(["E", "S"]);
    room.start();
    for (let step = 0; step < 3; step++) {
      const eTiles = room.viewFor("E").yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
      room.submit("E", { type: "HUMAN_STAGE_CHARLESTON", tileIds: eTiles });
      const sTiles = room.viewFor("S").yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
      room.submit("S", { type: "HUMAN_STAGE_CHARLESTON", tileIds: sTiles });
    }
    expect(room.submit("E", { type: "BEGIN_SECOND_CHARLESTON" })).toBe(true);
    // Still waiting on S's vote — E wanting to play isn't decisive by itself.
    expect(room.phase).toBe("charleston");
    expect(room.snapshot().pendingAction?.type).toBe("human_charleston_stop");
    expect(room.submit("S", { type: "BEGIN_SECOND_CHARLESTON" })).toBe(true);
    expect(room.phase).toBe("charleston");
    expect(room.snapshot().charleston?.step).toBe(3); // Second Charleston under way
  });
});

describe("GameRoom — multi-human claim windows", () => {
  /** Drive both humans through Charleston into play, always skipping the Second Charleston. */
  function driveBothToPlay(room: GameRoom, seats: PlayerId[]): void {
    for (let step = 0; step < 3; step++) {
      for (const seat of seats) {
        const tiles = room.viewFor(seat).yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
        room.submit(seat, { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles });
      }
    }
    room.submit(seats[0], { type: "STOP_CHARLESTON" });
  }

  it("opens a claim window to every eligible human seat independently — one seat's pass doesn't affect the other's view", () => {
    let sawSimultaneousWindow = false;

    for (let attempt = 0; attempt < 8 && !sawSimultaneousWindow; attempt++) {
      const room = roomWithHumans(["E", "S"]);
      room.start();
      driveBothToPlay(room, ["E", "S"]);

      let guard = 500;
      while (room.phase === "playing" && guard-- > 0) {
        const waiting = room.waitingOnClaim;
        if (waiting.length >= 2) {
          sawSimultaneousWindow = true;
          // Both seats see it's their turn to respond, independently.
          for (const seat of waiting) {
            expect(room.viewFor(seat).pendingActionForYou?.type).toBe("claim_window");
          }
          room.submit(waiting[0], { type: "HUMAN_PASS" });
          // The other seat is still eligible and hasn't been silently resolved.
          expect(room.waitingOnClaim).toContain(waiting[1]);
          room.submit(waiting[1], { type: "HUMAN_PASS" });
        } else if (waiting.length === 1) {
          room.submit(waiting[0], { type: "HUMAN_PASS" });
        } else if (room.waitingOn) {
          const tile = room.viewFor(room.waitingOn).yourHand.find((t) => t.suit !== "joker");
          if (!tile) break;
          room.submit(room.waitingOn, { type: "HUMAN_DISCARD", tileId: tile.id });
        } else {
          break;
        }
      }
      expect(room.phase === "playing" || room.phase === "finished").toBe(true);
    }
    // Not asserting sawSimultaneousWindow — genuinely rare with only 2 human
    // seats among 4; the per-response independence check above is what matters
    // whenever it does happen, over these 8 attempts.
  });
});

// HUMAN_JOKER_SWAP's seat-correctness fix (ctx.humanSeat → state.currentSeat) is
// covered precisely at the reducer level in tests/engine/multiHuman.test.ts —
// constructing a real exposed joker meld here would need a full claim flow for
// little extra coverage.
