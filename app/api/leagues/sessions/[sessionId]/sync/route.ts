// POST /api/leagues/sessions/:sessionId/sync — auto-feed ScoreRecords from linked rooms' finished
// Matches (source="online"). Commissioner-only. Safe to call repeatedly; unfinished rooms are skipped,
// not errored.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { syncSessionScoresFromRooms } from "@/lib/server/league";

export async function POST(_req: Request, { params }: { params: { sessionId: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await syncSessionScoresFromRooms(params.sessionId, user.id);
  if (!result) return NextResponse.json({ error: "not commissioner" }, { status: 403 });
  return NextResponse.json(result);
}
