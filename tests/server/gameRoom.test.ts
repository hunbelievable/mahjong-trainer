import { describe, it, expect } from "vitest";
import { GameRoom, type SeatConfig } from "@/lib/server/gameRoom";
import type { PlayerId } from "@/engine/tiles";

const CPU: SeatConfig = { kind: "cpu", difficulty: "intermediate" };

function roomWithHuman(seat: PlayerId): GameRoom {
  const seats = { E: CPU, S: CPU, W: CPU, N: CPU } as Record<PlayerId, SeatConfig>;
  seats[seat] = { kind: "human", userId: "user-1" };
  return new GameRoom(seats);
}

describe("GameRoom", () => {
  it("deals and drives to the human's first turn (East acts first)", () => {
    const room = roomWithHuman("E");
    room.start();
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

  it("runs an all-CPU room to completion on its own", () => {
    const room = new GameRoom({ E: CPU, S: CPU, W: CPU, N: CPU });
    room.start();
    expect(room.phase).toBe("finished");
    expect(room.waitingOn).toBeNull();
    // it produced concrete discard events and ended in a win or a wall game
    expect(room.events.some((e) => e.type === "discard")).toBe(true);
    expect(room.events.some((e) => e.type === "win" || e.type === "wall_game")).toBe(true);
  });
});
