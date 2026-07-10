// GET /api/leagues/seasons/:seasonId/standings — cumulative payout points per member. Member-only.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { getSeasonStandings, seasonLeagueId, isLeagueMember } from "@/lib/server/league";

export async function GET(_req: Request, { params }: { params: { seasonId: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const leagueId = await seasonLeagueId(params.seasonId);
  if (!leagueId || !(await isLeagueMember(leagueId, user.id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const standings = await getSeasonStandings(params.seasonId);
  return NextResponse.json({ standings });
}
