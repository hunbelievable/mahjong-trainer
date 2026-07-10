// POST /api/leagues/:id/seasons — create a season. Commissioner-only.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { createSeason } from "@/lib/server/league";

const MAX_NAME_LENGTH = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
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

  const season = await createSeason(params.id, user.id, raw.trim().slice(0, MAX_NAME_LENGTH));
  if (!season) return NextResponse.json({ error: "not commissioner" }, { status: 403 });
  return NextResponse.json({ seasonId: season.id });
}
