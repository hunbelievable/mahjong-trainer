import { describe, it, expect } from "vitest";
import { RoomManager } from "@/lib/server/roomManager";
import type { EventLog } from "@/lib/server/eventLog";
import type { RoomEvent } from "@/lib/server/gameRoom";
import { nextDealer } from "@/lib/server/match";

/**
 * Drive a just-started room through its Charleston (3 arbitrary non-joker
 * tiles each step, then skip the Second Charleston) so tests that only care
 * about play-phase behavior don't have to hand-roll this. Charleston pauses
 * for a real human now (see lib/server/gameRoom.ts), so start() alone no
 * longer reaches the playing phase.
 */
function driveCharlestonToPlay(mgr: RoomManager, id: string, userId: string): void {
  for (let step = 0; step < 3; step++) {
    const tiles = mgr.viewFor(id, userId)!.yourHand.filter((t) => t.suit !== "joker").slice(0, 3).map((t) => t.id);
    mgr.submit(id, userId, { type: "HUMAN_STAGE_CHARLESTON", tileIds: tiles });
  }
  mgr.submit(id, userId, { type: "STOP_CHARLESTON" });
}

/** In-memory EventLog test double — proves RoomManager's persistence wiring without a live NATS server. */
class FakeEventLog implements EventLog {
  appended: Array<{ roomId: string; event: RoomEvent }> = [];
  private byRoom = new Map<string, RoomEvent[]>();

  async append(roomId: string, event: RoomEvent): Promise<void> {
    this.appended.push({ roomId, event });
    const list = this.byRoom.get(roomId) ?? [];
    list.push(event);
    this.byRoom.set(roomId, list);
  }
  async readAll(roomId: string): Promise<RoomEvent[]> {
    return [...(this.byRoom.get(roomId) ?? [])];
  }
  async close(): Promise<void> {}
}

describe("RoomManager — lobby", () => {
  it("creates a room with four open seats", () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom("creator");
    expect(room.id).toMatch(/^[A-Z2-9]{6}$/);
    expect(Object.values(room.seats).every((s) => s.kind === "open")).toBe(true);
    expect(mgr.statusOf(room)).toBe("lobby");
  });

  it("lets a user claim one open seat and blocks conflicts", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");

    expect(mgr.claimSeat(id, "E", "alice")).toBe(true);
    expect(mgr.claimSeat(id, "E", "bob")).toBe(false);   // seat taken
    expect(mgr.claimSeat(id, "S", "alice")).toBe(false); // one seat per user
    expect(mgr.claimSeat(id, "S", "bob")).toBe(true);

    const room = mgr.getRoom(id)!;
    expect(mgr.seatOf(room, "alice")).toBe("E");
    expect(mgr.seatOf(room, "bob")).toBe("S");
  });

  it("releases a seat back to open", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "W", "carol");
    expect(mgr.releaseSeat(id, "carol")).toBe(true);
    expect(mgr.getRoom(id)!.seats.W.kind).toBe("open");
    expect(mgr.releaseSeat(id, "carol")).toBe(false); // no longer seated
  });

  it("sets open seats to CPU but not human seats", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    expect(mgr.setSeatCpu(id, "S", "advanced")).toBe(true);
    expect(mgr.getRoom(id)!.seats.S).toEqual({ kind: "cpu", difficulty: "advanced" });
    expect(mgr.setSeatCpu(id, "E", "beginner")).toBe(false); // can't overwrite a human
  });

  it("reflects the lobby in lobbyView with isYou", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    const view = mgr.lobbyView(id, "alice")!;
    expect(view.yourSeat).toBe("E");
    expect(view.seats.find((s) => s.seat === "E")).toMatchObject({ kind: "human", isYou: true });
    // bob sees alice's seat as taken but not "isYou"
    expect(mgr.lobbyView(id, "bob")!.seats.find((s) => s.seat === "E")).toMatchObject({ kind: "human", isYou: false });
  });
});

describe("RoomManager — starting & play", () => {
  it("fills open seats with CPUs and starts, seating the human", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice"); // East acts first

    expect(mgr.start(id)).toBe(true);
    driveCharlestonToPlay(mgr, id, "alice");
    const room = mgr.getRoom(id)!;
    expect(mgr.statusOf(room)).toBe("playing");
    expect(room.game!.waitingOn).toBe("E");
    // open seats became CPUs
    expect(room.seats.S.kind).toBe("open"); // lobby seat record is untouched…
    // …but the running game treats them as CPU (only the human is waited on)

    // alice gets a redacted view; a non-seated user gets nothing
    const view = mgr.viewFor(id, "alice")!;
    expect(view.yourHand.length).toBe(14);
    expect(mgr.viewFor(id, "nobody")).toBeNull();
  });

  it("authorizes submit by seat ownership", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");

    const tile = mgr.viewFor(id, "alice")!.yourHand.find((t) => t.suit !== "joker")!;
    // a user with no seat can't act
    expect(mgr.submit(id, "nobody", { type: "HUMAN_DISCARD", tileId: tile.id })).toBe(false);
    // the seated human can
    expect(mgr.submit(id, "alice", { type: "HUMAN_DISCARD", tileId: tile.id })).toBe(true);
  });

  it("blocks lobby mutations once started", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    expect(mgr.claimSeat(id, "S", "bob")).toBe(false);
    expect(mgr.setSeatCpu(id, "S", "beginner")).toBe(false);
    expect(mgr.start(id)).toBe(false); // already started
  });
});

describe("RoomManager — event log persistence", () => {
  it("defaults to a no-op event log — play works with no eventLog passed to the constructor", () => {
    const mgr = new RoomManager(); // matches every other test in this file
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    expect(mgr.start(id)).toBe(true); // must not throw
  });

  it("persists start()'s events to the injected event log", async () => {
    const log = new FakeEventLog();
    const mgr = new RoomManager(log);
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);

    expect(log.appended.length).toBeGreaterThan(0);
    expect(log.appended.every((a) => a.roomId === id)).toBe(true);
    expect(log.appended[0].event.type).toBe("init");

    const readBack = await mgr.persistedEvents(id);
    expect(readBack).toEqual(log.appended.map((a) => a.event));
  });

  it("persists new events from submit() without re-persisting earlier ones", async () => {
    const log = new FakeEventLog();
    const mgr = new RoomManager(log);
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");
    const afterStart = log.appended.length;

    const tile = mgr.viewFor(id, "alice")!.yourHand.find((t) => t.suit !== "joker")!;
    mgr.submit(id, "alice", { type: "HUMAN_DISCARD", tileId: tile.id });

    expect(log.appended.length).toBeGreaterThan(afterStart);
    // no duplicate entries for the events already persisted after start()
    const seqs = log.appended.map((a) => a.event.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("swaps in a real event log via setEventLog before any events are persisted", () => {
    const mgr = new RoomManager(); // starts with the default no-op
    const log = new FakeEventLog();
    mgr.setEventLog(log);

    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);

    expect(log.appended.length).toBeGreaterThan(0);
  });
});

describe("RoomManager — match & rotation", () => {
  it("creates a match on first start(): dealer = physical seat E, identity wind assignment for game 1", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");

    const match = mgr.viewFor(id, "alice")!.match!;
    expect(match.gameNumber).toBe(1);
    expect(match.dealerSeat).toBe("E");
    expect(match.canStartNextGame).toBe(false); // still playing
    expect(match.players.find((p) => p.seat === "E")).toMatchObject({
      kind: "human",
      isYou: true,
      score: 0,
    });
    // open S/W/N seats became CPUs for the match, same as the underlying game
    expect(match.players.filter((p) => p.kind === "cpu")).toHaveLength(3);
  });

  it("records match history + zero-sum standings once a game finishes, and rotates the dealer correctly", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");

    // Drive the human's seat (pass every claim window, discard otherwise) until the game ends.
    let guard = 500;
    while (mgr.getRoom(id)!.game!.phase === "playing" && guard-- > 0) {
      const view = mgr.viewFor(id, "alice")!;
      const pa = view.pendingActionForYou;
      if (pa?.type === "claim_window") {
        mgr.submit(id, "alice", { type: "HUMAN_PASS" });
      } else if (pa?.type === "human_discard") {
        const tile = view.yourHand.find((t) => t.suit !== "joker");
        if (!tile) break;
        mgr.submit(id, "alice", { type: "HUMAN_DISCARD", tileId: tile.id });
      } else {
        break;
      }
    }

    expect(mgr.getRoom(id)!.game!.phase).toBe("finished");
    const finishedView = mgr.viewFor(id, "alice")!;
    expect(finishedView.match!.canStartNextGame).toBe(true);
    expect(finishedView.match!.history).toHaveLength(1);
    const scoreSum = finishedView.match!.players.reduce((sum, p) => sum + p.score, 0);
    expect(scoreSum).toBe(0); // zero-sum

    const played = finishedView.match!.history[0];
    const expectedDealer = nextDealer("E", played.winnerSeat, played.winKind);

    expect(mgr.startNextGame(id, "alice")).toBe(true);
    const nextView = mgr.viewFor(id, "alice")!;
    expect(nextView.phase).toBe("charleston"); // fresh game re-deals + re-Charlestons
    expect(nextView.match!.gameNumber).toBe(2);
    expect(nextView.match!.dealerSeat).toBe(expectedDealer);
    expect(nextView.match!.canStartNextGame).toBe(false);
  });

  it("startNextGame is rejected until the current game is finished, and requires a seated user", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice"); // now "playing", not finished

    expect(mgr.startNextGame(id, "alice")).toBe(false);
    expect(mgr.startNextGame(id, "nobody")).toBe(false);
  });
});

describe("RoomManager — kickSeat & forfeitSeat", () => {
  it("kickSeat requires the requesting user to be the room's creator", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");

    expect(mgr.kickSeat(id, "not-the-creator", "E")).toBe(false);
    expect(mgr.viewFor(id, "alice")!.pendingActionForYou).not.toBeNull(); // alice untouched
    expect(mgr.kickSeat(id, "creator", "E")).toBe(true);
  });

  it("kickSeat fails before the match has started", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    // still in the lobby — no match/game yet
    expect(mgr.kickSeat(id, "creator", "E")).toBe(false);
  });

  it("kicked seat becomes CPU immediately: lobby record, match roster, and no longer submittable by that user", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");

    expect(mgr.kickSeat(id, "creator", "E")).toBe(true);

    const room = mgr.getRoom(id)!;
    expect(room.seats.E).toEqual({ kind: "cpu", difficulty: "intermediate" });
    expect(mgr.viewFor(id, "alice")).toBeNull(); // alice no longer holds a seat
    // The game itself kept running (CPU took over) rather than getting stuck.
    expect(room.game!.phase === "playing" || room.game!.phase === "finished").toBe(true);
  });

  it("forfeitSeat lets a seated player convert their own seat, but not someone else's", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");

    expect(mgr.forfeitSeat(id, "nobody")).toBe(false); // not seated at all
    expect(mgr.forfeitSeat(id, "alice")).toBe(true);
    expect(mgr.getRoom(id)!.seats.E.kind).toBe("cpu");
  });

  it("kicking the room's only human lets the now-all-CPU game finish on its own, and the roster stays CPU for the next game", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");
    mgr.kickSeat(id, "creator", "E");

    // No human left in the room — convertSeatToCpu's own drive() call should
    // have run the rest of the hand to completion without anyone prompting it.
    const room = mgr.getRoom(id)!;
    expect(room.game!.phase).toBe("finished");
    // match.players is exactly what beginGame() reads to build each new game's
    // seat config — this being CPU is what makes the kick "stick" for future
    // games in the match, not just the one it happened in.
    expect(room.match!.players.E.isCpu).toBe(true);
    expect(room.match!.players.E.cpuDifficulty).toBe("intermediate");
  });
});

describe("RoomManager — closeRoom", () => {
  it("requires the requesting user to be the room's creator", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");

    expect(mgr.closeRoom(id, "alice")).toBe(false); // seated, but not the creator
    expect(mgr.statusOf(mgr.getRoom(id)!)).toBe("lobby");
    expect(mgr.closeRoom(id, "creator")).toBe(true);
    expect(mgr.statusOf(mgr.getRoom(id)!)).toBe("closed");
  });

  it("works from the lobby, before any game has started", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    expect(mgr.closeRoom(id, "creator")).toBe(true);
    expect(mgr.statusOf(mgr.getRoom(id)!)).toBe("closed");
  });

  it("works mid-game, abandoning whatever was in progress", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");

    expect(mgr.closeRoom(id, "creator")).toBe(true);
    expect(mgr.statusOf(mgr.getRoom(id)!)).toBe("closed");
  });

  it("is idempotent — a second close attempt fails", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    expect(mgr.closeRoom(id, "creator")).toBe(true);
    expect(mgr.closeRoom(id, "creator")).toBe(false);
  });

  it("blocks every mutating action once closed", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");
    mgr.closeRoom(id, "creator");

    expect(mgr.claimSeat(id, "S", "bob")).toBe(false);
    expect(mgr.releaseSeat(id, "alice")).toBe(false);
    expect(mgr.setSeatCpu(id, "S", "beginner")).toBe(false);
    expect(mgr.start(id)).toBe(false);
    expect(mgr.startNextGame(id, "alice")).toBe(false);
    expect(mgr.forfeitSeat(id, "alice")).toBe(false);
    expect(mgr.kickSeat(id, "creator", "E")).toBe(false);
    expect(mgr.submit(id, "alice", { type: "HUMAN_PASS" })).toBe(false);
  });
});

describe("RoomManager — chat", () => {
  it("requires a held seat to send, and attributes messages by physical seat", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");

    expect(mgr.sendChatMessage(id, "nobody", "hi")).toBeNull(); // not seated
    const msg = mgr.sendChatMessage(id, "alice", "nice hand!");
    expect(msg).toMatchObject({ seat: "E", text: "nice hand!" });
    expect(mgr.chatHistory(id)).toEqual([msg]);
  });

  it("trims whitespace and rejects empty/whitespace-only messages", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");

    expect(mgr.sendChatMessage(id, "alice", "   ")).toBeNull();
    expect(mgr.sendChatMessage(id, "alice", "")).toBeNull();
    const msg = mgr.sendChatMessage(id, "alice", "  hello  ");
    expect(msg?.text).toBe("hello");
  });

  it("caps history at the ring-buffer limit, dropping the oldest first", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");

    for (let i = 0; i < 55; i++) mgr.sendChatMessage(id, "alice", `msg-${i}`);
    const history = mgr.chatHistory(id);
    expect(history).toHaveLength(50);
    expect(history[0].text).toBe("msg-5"); // the first 5 were dropped
    expect(history[history.length - 1].text).toBe("msg-54");
  });

  it("works before the match starts (lobby) as well as mid-game", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");

    expect(mgr.sendChatMessage(id, "alice", "ready when you are")).not.toBeNull();

    mgr.start(id);
    driveCharlestonToPlay(mgr, id, "alice");
    expect(mgr.sendChatMessage(id, "alice", "good draw")).not.toBeNull();
    expect(mgr.chatHistory(id)).toHaveLength(2);
  });

  it("is blocked once the room is closed", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom("creator");
    mgr.claimSeat(id, "E", "alice");
    mgr.closeRoom(id, "creator");

    expect(mgr.sendChatMessage(id, "alice", "hello?")).toBeNull();
  });
});
