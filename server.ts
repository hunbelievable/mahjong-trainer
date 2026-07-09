// =============================================================================
// Custom Node server — the single process serving both Next.js (HTTP) and the
// multiplayer WebSocket upgrade. Replaces `next dev` / `next start` as the app's
// entrypoint now that multiplayer is part of the app's core architecture, not a
// bolt-on kept at arm's length (see docs/multiplayer-design.md §§1, 3).
//
// SECURITY NOTE re: GHSA-c4j6-fc7j-m34r (Next.js SSRF via WebSocket upgrades,
// unpatched on the 14.x line as of this writing): that advisory is about Next's
// own built-in server proxying WS upgrades through its rewrites/middleware
// machinery. We never hand upgrade requests to Next at all — `server.on(
// "upgrade", ...)` intercepts them before Next's request handler is invoked, and
// they're handled entirely by our own `ws.WebSocketServer`. Next's request
// handler (`handleNextRequest`) is only ever called for plain HTTP requests.
// =============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import { userIdFromRequest } from "./lib/server/accessIdentity";
import { roomManager } from "./lib/server/roomManager";
import { wsHub } from "./lib/server/wsHub";
import { createEventLog } from "./lib/server/eventLog";
import { handleRoomApi } from "./lib/server/roomApi";
import type { GameAction } from "./engine/gameEngine";
import type { PlayerId } from "./engine/tiles";
import type { ClaimType } from "./engine/cpu";

const dev = process.env.NODE_ENV !== "production";
// For next({...})'s own self-referential URL construction ONLY — NOT the bind
// address (server.listen(port) below binds all interfaces regardless of this
// value). "0.0.0.0" is a valid bind address but never a valid self-identifying
// hostname; using it here broke Auth.js's callback URL construction (every
// signin/callback URL came back as http://0.0.0.0:3000/... instead of the
// real request host). Matches Next's own official custom-server example.
const hostname = "localhost";
const port = Number(process.env.PORT) || 3000;

const app = next({ dev, hostname, port });
const handleNextRequest = app.getRequestHandler();

app.prepare().then(async () => {
  // Connect durable event persistence before serving any traffic, so every
  // room created from the first request onward is backed by it (falls back to
  // a no-op log if NATS_URL isn't set — see createEventLog).
  roomManager.setEventLog(await createEventLog());

  const server = createServer((req, res) => {
    void handleHttpRequest(req, res);
  });

  // /api/rooms* is handled directly here (not as a Next Route Handler) so it
  // shares the exact same roomManager/wsHub module instances as the WS
  // handler below — see lib/server/roomApi.ts header comment for why that
  // isn't automatic in a custom-server setup.
  async function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
    const handled = await handleRoomApi(req, res);
    if (handled) return;
    handleNextRequest(req, res, parse(req.url ?? "/", true));
  }

  // `noServer: true` — we own the handshake ourselves (see header comment).
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    void handleUpgrade(req, socket, head);
  });

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const { pathname, query } = parse(req.url ?? "", true);
    const roomId = typeof query.room === "string" ? query.room : null;

    if (pathname !== "/ws" || !roomId) {
      socket.destroy();
      return;
    }

    const userId = await userIdFromRequest(req);
    if (!userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      attachConnection(ws, roomId, userId);
    });
  }

  function attachConnection(ws: WebSocket, roomId: string, userId: string) {
    const unregister = wsHub.connect(roomId, userId, {
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
    });

    // Play surface: Charleston pass/stop/begin-second, discard, claim/pass on
    // a claim window, joker swap. Lobby
    // actions (claim seat, set CPU, start) go through app/api/rooms/[id]/actions.
    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Chat never touches the engine — a separate path from game actions.
      if (msg && typeof msg === "object" && (msg as Record<string, unknown>).type === "chat") {
        const text = (msg as Record<string, unknown>).text;
        if (typeof text !== "string") return;
        const sent = roomManager.sendChatMessage(roomId, userId, text);
        if (sent) wsHub.broadcastChat(roomId, sent);
        return;
      }

      const action = toGameAction(msg);
      if (!action) return;

      const ok = roomManager.submit(roomId, userId, action);
      if (ok) wsHub.broadcastRoom(roomId);
      else ws.send(JSON.stringify({ type: "error", message: "illegal move" }));
    });

    ws.on("close", unregister);
  }

  /** Validate + translate an incoming WS message into an engine GameAction, or null if malformed. */
  function toGameAction(msg: unknown): GameAction | null {
    if (!msg || typeof msg !== "object") return null;
    const m = msg as Record<string, unknown>;

    if (m.type === "discard" && typeof m.tileId === "string") {
      return { type: "HUMAN_DISCARD", tileId: m.tileId };
    }
    if (m.type === "pass") {
      return { type: "HUMAN_PASS" };
    }
    if (m.type === "claim" && typeof m.claimType === "string") {
      return { type: "HUMAN_CLAIM", claimType: m.claimType as ClaimType };
    }
    if (m.type === "charlestonPass" && Array.isArray(m.tileIds) && m.tileIds.every((id) => typeof id === "string")) {
      return { type: "HUMAN_STAGE_CHARLESTON", tileIds: m.tileIds as string[] };
    }
    if (m.type === "charlestonStop") {
      return { type: "STOP_CHARLESTON" };
    }
    if (m.type === "charlestonBeginSecond") {
      return { type: "BEGIN_SECOND_CHARLESTON" };
    }
    if (
      m.type === "jokerSwap" &&
      typeof m.meldOwnerSeat === "string" &&
      typeof m.meldIndex === "number" &&
      typeof m.jokerTileId === "string" &&
      typeof m.handTileId === "string"
    ) {
      return {
        type: "HUMAN_JOKER_SWAP",
        meldOwnerSeat: m.meldOwnerSeat as PlayerId,
        meldIndex: m.meldIndex,
        jokerTileId: m.jokerTileId,
        handTileId: m.handTileId,
      };
    }
    return null;
  }

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port} (dev=${dev})`);
  });
});
