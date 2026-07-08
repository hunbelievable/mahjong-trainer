import { describe, it, expect } from "vitest";
import { RoomManager } from "@/lib/server/roomManager";
import type { EventLog } from "@/lib/server/eventLog";
import type { RoomEvent } from "@/lib/server/gameRoom";

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
    const room = mgr.createRoom();
    expect(room.id).toMatch(/^[A-Z2-9]{6}$/);
    expect(Object.values(room.seats).every((s) => s.kind === "open")).toBe(true);
    expect(mgr.statusOf(room)).toBe("lobby");
  });

  it("lets a user claim one open seat and blocks conflicts", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom();

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
    const { id } = mgr.createRoom();
    mgr.claimSeat(id, "W", "carol");
    expect(mgr.releaseSeat(id, "carol")).toBe(true);
    expect(mgr.getRoom(id)!.seats.W.kind).toBe("open");
    expect(mgr.releaseSeat(id, "carol")).toBe(false); // no longer seated
  });

  it("sets open seats to CPU but not human seats", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom();
    mgr.claimSeat(id, "E", "alice");
    expect(mgr.setSeatCpu(id, "S", "advanced")).toBe(true);
    expect(mgr.getRoom(id)!.seats.S).toEqual({ kind: "cpu", difficulty: "advanced" });
    expect(mgr.setSeatCpu(id, "E", "beginner")).toBe(false); // can't overwrite a human
  });

  it("reflects the lobby in lobbyView with isYou", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom();
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
    const { id } = mgr.createRoom();
    mgr.claimSeat(id, "E", "alice"); // East acts first

    expect(mgr.start(id)).toBe(true);
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
    const { id } = mgr.createRoom();
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);

    const tile = mgr.viewFor(id, "alice")!.yourHand.find((t) => t.suit !== "joker")!;
    // a user with no seat can't act
    expect(mgr.submit(id, "nobody", { type: "HUMAN_DISCARD", tileId: tile.id })).toBe(false);
    // the seated human can
    expect(mgr.submit(id, "alice", { type: "HUMAN_DISCARD", tileId: tile.id })).toBe(true);
  });

  it("blocks lobby mutations once started", () => {
    const mgr = new RoomManager();
    const { id } = mgr.createRoom();
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
    const { id } = mgr.createRoom();
    mgr.claimSeat(id, "E", "alice");
    expect(mgr.start(id)).toBe(true); // must not throw
  });

  it("persists start()'s events to the injected event log", async () => {
    const log = new FakeEventLog();
    const mgr = new RoomManager(log);
    const { id } = mgr.createRoom();
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
    const { id } = mgr.createRoom();
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);
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

    const { id } = mgr.createRoom();
    mgr.claimSeat(id, "E", "alice");
    mgr.start(id);

    expect(log.appended.length).toBeGreaterThan(0);
  });
});
