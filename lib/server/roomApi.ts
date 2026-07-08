// =============================================================================
// Plain-Node HTTP handlers for /api/rooms* — intentionally NOT Next.js Route
// Handlers.
//
// Next.js bundles Route Handler code separately from whatever server.ts
// imports directly (its own webpack-compiled module graph under .next/server,
// loaded through Next's own module system). Even in the same OS process, that
// means a Next Route Handler and server.ts's WS upgrade handler end up with
// TWO INDEPENDENT instances of the `roomManager`/`wsHub` singletons — a room
// created via a Route Handler is invisible to code importing the "same"
// module directly. Confirmed live: POST /api/rooms (as a Route Handler)
// created a room found successfully by a follow-up GET (same Route Handler
// runtime), but the WS connection reported "room not found" for that exact
// room id.
//
// Handling these routes directly in server.ts's own request callback
// guarantees HTTP and WS share the exact same module instances, by
// construction — there is no other module graph for them to diverge into.
// =============================================================================

import type { IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";
import { userIdFromCookieHeader } from "./sessionFromRequest";
import { roomManager } from "./roomManager";
import { wsHub } from "./wsHub";
import type { PlayerId } from "@/engine/tiles";
import type { DifficultyLevel } from "@/engine/cpu";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

interface ActionBody {
  action: "claimSeat" | "releaseSeat" | "setCpu" | "start";
  seat?: PlayerId;
  difficulty?: DifficultyLevel;
}

/**
 * Handles a request if its path matches /api/rooms*, writing the response
 * directly and returning true. Returns false (touching nothing on `res`) if
 * the path doesn't match, so the caller can fall through to Next.
 */
export async function handleRoomApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { pathname } = parse(req.url ?? "", true);
  if (!pathname || !pathname.startsWith("/api/rooms")) return false;

  const segments = pathname.split("/").filter(Boolean); // ["api", "rooms", ...]
  const userId = await userIdFromCookieHeader(req.headers.cookie);

  // POST /api/rooms — create a room
  if (segments.length === 2 && req.method === "POST") {
    if (!userId) { sendJson(res, 401, { error: "unauthorized" }); return true; }
    const room = roomManager.createRoom();
    sendJson(res, 200, { roomId: room.id });
    return true;
  }

  // GET /api/rooms/:id — current view (lobby or, if seated, the redacted game view)
  if (segments.length === 3 && req.method === "GET") {
    if (!userId) { sendJson(res, 401, { error: "unauthorized" }); return true; }
    const id = segments[2];
    const room = roomManager.getRoom(id);
    if (!room) { sendJson(res, 404, { error: "not found" }); return true; }
    if (roomManager.statusOf(room) === "lobby") {
      sendJson(res, 200, { type: "lobby", view: roomManager.lobbyView(id, userId) });
      return true;
    }
    const view = roomManager.viewFor(id, userId);
    if (!view) { sendJson(res, 403, { error: "not seated in this game" }); return true; }
    sendJson(res, 200, { type: "game", view });
    return true;
  }

  // POST /api/rooms/:id/actions — lobby mutations
  if (segments.length === 4 && segments[3] === "actions" && req.method === "POST") {
    if (!userId) { sendJson(res, 401, { error: "unauthorized" }); return true; }
    const id = segments[2];

    let body: ActionBody;
    try {
      body = (await readJsonBody(req)) as ActionBody;
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return true;
    }

    let ok = false;
    switch (body.action) {
      case "claimSeat":
        if (!body.seat) { sendJson(res, 400, { error: "seat required" }); return true; }
        ok = roomManager.claimSeat(id, body.seat, userId);
        break;
      case "releaseSeat":
        ok = roomManager.releaseSeat(id, userId);
        break;
      case "setCpu":
        if (!body.seat || !body.difficulty) {
          sendJson(res, 400, { error: "seat and difficulty required" });
          return true;
        }
        ok = roomManager.setSeatCpu(id, body.seat, body.difficulty);
        break;
      case "start":
        ok = roomManager.start(id);
        break;
      default:
        sendJson(res, 400, { error: "unknown action" });
        return true;
    }

    if (!ok) { sendJson(res, 409, { error: "action failed" }); return true; }

    // Push the update to any already-connected WS clients (e.g. everyone
    // else in the lobby, or every seated player once the game just started).
    wsHub.broadcastRoom(id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Matches /api/rooms* but no known route.
  sendJson(res, 404, { error: "not found" });
  return true;
}
