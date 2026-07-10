// GET /api/leagues/seasons/:seasonId — season detail (sessions list). Member-only.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { getSeasonDetail, seasonLeagueId, isLeagueMember } from "@/lib/server/league";

export async function GET(_req: Request, { params }: { params: { seasonId: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const leagueId = await seasonLeagueId(params.seasonId);
  if (!leagueId || !(await isLeagueMember(leagueId, user.id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const season = await getSeasonDetail(params.seasonId);
  if (!season) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ season });
}
