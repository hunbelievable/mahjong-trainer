// GET /api/leagues/:id — league detail (members, seasons). Member-only.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { getLeagueDetail, isLeagueMember } from "@/lib/server/league";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!(await isLeagueMember(params.id, user.id))) {
    return NextResponse.json({ error: "not a member of this league" }, { status: 403 });
  }

  const league = await getLeagueDetail(params.id);
  if (!league) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ league });
}
