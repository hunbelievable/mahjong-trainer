import { describe, it, expect, vi } from "vitest";
import { WsHub, type HubSocket } from "@/lib/server/wsHub";
import { RoomManager } from "@/lib/server/roomManager";

function fakeSocket(): HubSocket & { messages: unknown[] } {
  const messages: unknown[] = [];
  return {
    messages,
    send: vi.fn((data: string) => messages.push(JSON.parse(data))),
    close: vi.fn(),
  };
}

describe("WsHub", () => {
  it("pushes a lobby view immediately on connect", () => {
    const manager = new RoomManager();
    const hub = new WsHub(manager);
    const { id } = manager.createRoom("creator");
    manager.claimSeat(id, "E", "alice");

    const sock = fakeSocket();
    hub.connect(id, "alice", sock);

    expect(sock.messages).toHaveLength(1);
    expect(sock.messages[0]).toMatchObject({ type: "lobby", view: { yourSeat: "E" } });
  });

  it("broadcasts an updated lobby view to all connections after a lobby mutation", () => {
    const manager = new RoomManager();
    const hub = new WsHub(manager);
    const { id } = manager.createRoom("creator");
    manager.claimSeat(id, "E", "alice");

    const aliceSock = fakeSocket();
    const bobSock = fakeSocket();
    hub.connect(id, "alice", aliceSock);
    hub.connect(id, "bob", bobSock); // bob hasn't claimed a seat yet

    manager.claimSeat(id, "S", "bob");
    hub.broadcastRoom(id);

    // each got their initial push + one broadcast push
    expect(aliceSock.messages).toHaveLength(2);
    expect(bobSock.messages).toHaveLength(2);
    const bobLatest = bobSock.messages[1] as { type: string; view: { yourSeat: string } };
    expect(bobLatest.type).toBe("lobby");
    expect(bobLatest.view.yourSeat).toBe("S");
  });

  it("switches a seated connection from lobby to game view once the game starts", () => {
    const manager = new RoomManager();
    const hub = new WsHub(manager);
    const { id } = manager.createRoom("creator");
    manager.claimSeat(id, "E", "alice"); // East acts first

    const sock = fakeSocket();
    hub.connect(id, "alice", sock); // lobby push #1

    manager.start(id, "creator");
    hub.broadcastRoom(id);

    expect(sock.messages).toHaveLength(2);
    const latest = sock.messages[1] as { type: string; view: { phase: string; yourHand: unknown[] } };
    expect(latest.type).toBe("game");
    // start() now pauses at the Charleston (13-tile dealt hand) rather than
    // driving straight to the human's first 14-tile discard turn — see
    // lib/server/gameRoom.ts. The lobby→game push transition is what this
    // test is really about; the 14-tile playing-phase case is covered by
    // GameRoom's own "deals and drives to the human's first turn" test.
    expect(latest.view.phase).toBe("charleston");
    expect(latest.view.yourHand).toHaveLength(13);
  });

  it("never leaks another seat's concealed tiles to a connection's pushed view", () => {
    const manager = new RoomManager();
    const hub = new WsHub(manager);
    const { id } = manager.createRoom("creator");
    manager.claimSeat(id, "E", "alice");
    manager.claimSeat(id, "S", "bob");
    manager.start(id, "creator");

    const aliceSock = fakeSocket();
    hub.connect(id, "alice", aliceSock);

    const view = (aliceSock.messages[0] as { view: { yourHand: Array<{ id: string }>; opponents: unknown[] } }).view;
    expect(view.yourHand.length).toBe(13); // dealt hand, mid-Charleston — see comment above
    // opponents present only as counts/melds — never a concealed hand
    for (const opp of view.opponents as Array<Record<string, unknown>>) {
      expect(opp).not.toHaveProperty("hand");
      expect(opp).not.toHaveProperty("yourHand");
    }
  });

  it("errors and closes a connection that has no seat once the game has started", () => {
    const manager = new RoomManager();
    const hub = new WsHub(manager);
    const { id } = manager.createRoom("creator");
    manager.claimSeat(id, "E", "alice");

    const spectatorSock = fakeSocket();
    hub.connect(id, "spectator", spectatorSock); // lobby push #1 (yourSeat: null)

    manager.start(id, "creator");
    hub.broadcastRoom(id);

    // fatal: true — the client must show its terminal error screen here, not
    // a dismissible toast, since there's no seated view to fall back to.
    expect(spectatorSock.messages[1]).toMatchObject({ type: "error", fatal: true });
    expect(spectatorSock.close).toHaveBeenCalledWith(4001, "not seated");
  });

  it("stops pushing to a connection after it unregisters", () => {
    const manager = new RoomManager();
    const hub = new WsHub(manager);
    const { id } = manager.createRoom("creator");
    manager.claimSeat(id, "E", "alice");

    const sock = fakeSocket();
    const unregister = hub.connect(id, "alice", sock);
    expect(hub.connectionCount(id)).toBe(1);

    unregister();
    expect(hub.connectionCount(id)).toBe(0);

    manager.claimSeat(id, "S", "bob");
    hub.broadcastRoom(id);
    expect(sock.messages).toHaveLength(1); // no further pushes after unregister
  });

  it("reports a room-not-found error for an unknown room id", () => {
    const manager = new RoomManager();
    const hub = new WsHub(manager);
    const sock = fakeSocket();
    hub.connect("NOSUCH", "alice", sock);
    expect(sock.messages[0]).toMatchObject({ type: "error", message: "room not found", fatal: true });
  });

  it("broadcastChat sends the same message to every connection uniformly, with no redaction", () => {
    const manager = new RoomManager();
    const hub = new WsHub(manager);
    const { id } = manager.createRoom("creator");
    manager.claimSeat(id, "E", "alice");
    manager.claimSeat(id, "S", "bob");

    const aliceSock = fakeSocket();
    const bobSock = fakeSocket();
    hub.connect(id, "alice", aliceSock);
    hub.connect(id, "bob", bobSock);

    const message = manager.sendChatMessage(id, "alice", "hello table")!;
    hub.broadcastChat(id, message);

    // each got their initial lobby push + the chat broadcast
    expect(aliceSock.messages).toHaveLength(2);
    expect(bobSock.messages).toHaveLength(2);
    expect(aliceSock.messages[1]).toEqual({ type: "chatMessage", message });
    expect(bobSock.messages[1]).toEqual({ type: "chatMessage", message }); // identical — no per-seat redaction
  });

  it("pushes recent chat history once on connect, after the lobby/game view", () => {
    const manager = new RoomManager();
    const hub = new WsHub(manager);
    const { id } = manager.createRoom("creator");
    manager.claimSeat(id, "E", "alice");
    manager.sendChatMessage(id, "alice", "already said this before bob joins");

    const bobSock = fakeSocket();
    hub.connect(id, "bob", bobSock);

    expect(bobSock.messages[0]).toMatchObject({ type: "lobby" });
    expect(bobSock.messages[1]).toMatchObject({
      type: "chatHistory",
      messages: [{ seat: "E", text: "already said this before bob joins" }],
    });
  });

  it("doesn't push a chatHistory message at all when there's no history yet", () => {
    const manager = new RoomManager();
    const hub = new WsHub(manager);
    const { id } = manager.createRoom("creator");

    const sock = fakeSocket();
    hub.connect(id, "alice", sock);

    expect(sock.messages).toHaveLength(1); // just the lobby push, no empty chatHistory frame
  });
});
