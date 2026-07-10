// =============================================================================
// GET /api/leagues — leagues the caller belongs to.
// POST /api/leagues — create a league (caller becomes commissioner).
// Normal Next.js Route Handler — see app/api/user/route.ts's header comment
// for why league/* doesn't need the raw server.ts treatment /api/rooms* does.
// =============================================================================

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { listMyLeagues, createLeague } from "@/lib/server/league";

const MAX_NAME_LENGTH = 60;

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const leagues = await listMyLeagues(user.id);
  return NextResponse.json({ leagues });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const raw = (body as { name?: unknown } | null)?.name;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const league = await createLeague(user.id, raw.trim().slice(0, MAX_NAME_LENGTH));
  return NextResponse.json({ leagueId: league.id });
}
