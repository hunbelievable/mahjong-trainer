// GET /api/leagues/:id/players/:userId — a member's full score history within this league. Member-only.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { getPlayerHistory, isLeagueMember } from "@/lib/server/league";

export async function GET(_req: Request, { params }: { params: { id: string; userId: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!(await isLeagueMember(params.id, user.id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // The target player must also be a member of this league — otherwise a
  // valid userId from an unrelated league could be used to probe scores here.
  if (!(await isLeagueMember(params.id, params.userId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const history = await getPlayerHistory(params.id, params.userId);
  if (!history) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ history });
}
