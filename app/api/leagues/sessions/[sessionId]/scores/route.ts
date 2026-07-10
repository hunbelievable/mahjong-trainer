// GET /api/leagues/sessions/:sessionId/scores — this session's entered scores. Member-only.
// POST /api/leagues/sessions/:sessionId/scores — bulk-enter/update scores. Commissioner-only.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { getSessionScores, enterScores, sessionLeagueId, isLeagueMember } from "@/lib/server/league";

export async function GET(_req: Request, { params }: { params: { sessionId: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const leagueId = await sessionLeagueId(params.sessionId);
  if (!leagueId || !(await isLeagueMember(leagueId, user.id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const scores = await getSessionScores(params.sessionId);
  return NextResponse.json({ scores });
}

interface ScoreEntryBody {
  userId?: unknown;
  points?: unknown;
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

  const rawEntries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return NextResponse.json({ error: "entries required" }, { status: 400 });
  }
  const entries: { userId: string; points: number }[] = [];
  for (const e of rawEntries as ScoreEntryBody[]) {
    if (typeof e.userId !== "string" || typeof e.points !== "number" || !Number.isFinite(e.points)) {
      return NextResponse.json({ error: "each entry needs a userId and a numeric points value" }, { status: 400 });
    }
    entries.push({ userId: e.userId, points: e.points });
  }

  const ok = await enterScores(params.sessionId, user.id, entries);
  if (!ok) return NextResponse.json({ error: "not commissioner" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
