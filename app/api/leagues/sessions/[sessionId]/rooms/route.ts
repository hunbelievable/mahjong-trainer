// POST /api/leagues/sessions/:sessionId/rooms — link a multiplayer room to this league night. Commissioner-only.
// GET  /api/leagues/sessions/:sessionId/rooms — linked rooms + whether each one's match has finished. Member-only.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { linkRoomToSession, getLinkedRooms, sessionLeagueId, isLeagueMember } from "@/lib/server/league";

export async function GET(_req: Request, { params }: { params: { sessionId: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const leagueId = await sessionLeagueId(params.sessionId);
  if (!leagueId || !(await isLeagueMember(leagueId, user.id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rooms = await getLinkedRooms(params.sessionId);
  return NextResponse.json({ rooms });
}

export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const roomId = (body as { roomId?: unknown } | null)?.roomId;
  if (typeof roomId !== "string" || roomId.trim().length === 0) {
    return NextResponse.json({ error: "roomId required" }, { status: 400 });
  }

  const ok = await linkRoomToSession(params.sessionId, user.id, roomId.trim());
  if (!ok) return NextResponse.json({ error: "not commissioner" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
