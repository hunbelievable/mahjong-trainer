// =============================================================================
// In-process WebSocket connection registry + broadcaster.
//
// Bridges RoomManager/GameRoom state changes to connected clients, pushing each
// connection ONLY the redacted view for its own userId — never raw state (see
// lib/server/redact.ts). Process-local for now; if the app ever needs to scale
// beyond one instance, NATS pub/sub replaces this registry without changing the
// per-connection push logic. See docs/multiplayer-design.md §3.
// =============================================================================

import { roomManager, type RoomManager, type ChatMessage } from "./roomManager";

/** The minimal socket surface the hub needs — real `ws.WebSocket` satisfies this. */
export interface HubSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Connection {
  userId: string;
  socket: HubSocket;
}

export class WsHub {
  private byRoom = new Map<string, Set<Connection>>();

  constructor(private manager: RoomManager) {}

  /** Register a connection, immediately push its current view, and return an unregister function. */
  connect(roomId: string, userId: string, socket: HubSocket): () => void {
    let set = this.byRoom.get(roomId);
    if (!set) {
      set = new Set();
      this.byRoom.set(roomId, set);
    }
    const conn: Connection = { userId, socket };
    set.add(conn);

    this.pushTo(roomId, conn);
    const history = this.manager.chatHistory(roomId);
    if (history.length > 0) {
      conn.socket.send(JSON.stringify({ type: "chatHistory", messages: history }));
    }

    return () => {
      set!.delete(conn);
      if (set!.size === 0) this.byRoom.delete(roomId);
    };
  }

  /** Recompute and push the current view to every connection registered for a room. */
  broadcastRoom(roomId: string): void {
    const set = this.byRoom.get(roomId);
    if (!set) return;
    for (const conn of Array.from(set)) this.pushTo(roomId, conn);
  }

  /** Number of live connections for a room — exposed for tests/diagnostics. */
  connectionCount(roomId: string): number {
    return this.byRoom.get(roomId)?.size ?? 0;
  }

  /** Broadcast one chat message to every connection in a room — same content for everyone, no per-seat redaction needed. */
  broadcastChat(roomId: string, message: ChatMessage): void {
    const set = this.byRoom.get(roomId);
    if (!set) return;
    const payload = JSON.stringify({ type: "chatMessage", message });
    for (const conn of Array.from(set)) conn.socket.send(payload);
  }

  private pushTo(roomId: string, conn: Connection): void {
    const room = this.manager.getRoom(roomId);
    if (!room) {
      conn.socket.send(JSON.stringify({ type: "error", message: "room not found" }));
      return;
    }

    const status = this.manager.statusOf(room);

    if (status === "closed") {
      conn.socket.send(JSON.stringify({ type: "closed" }));
      return;
    }

    if (status === "lobby") {
      conn.socket.send(JSON.stringify({ type: "lobby", view: this.manager.lobbyView(roomId, conn.userId) }));
      return;
    }

    const view = this.manager.viewFor(roomId, conn.userId);
    if (!view) {
      // Game started (or already finished) and this connection never held a seat —
      // no spectators in MVP (see design doc P5). Tell them and drop the connection.
      conn.socket.send(JSON.stringify({ type: "error", message: "not seated in this game" }));
      conn.socket.close(4001, "not seated");
      return;
    }

    conn.socket.send(JSON.stringify({ type: "game", view }));
  }
}

/** Process-wide singleton, paired with the `roomManager` singleton it wraps. */
export const wsHub = new WsHub(roomManager);
