// POST /api/leagues/seasons/:seasonId/sessions — "start league night". Commissioner-only.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { startSession } from "@/lib/server/league";

const MAX_LABEL_LENGTH = 60;

export async function POST(req: Request, { params }: { params: { seasonId: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const raw = (body as { label?: unknown } | null)?.label;
  const label = typeof raw === "string" && raw.trim().length > 0 ? raw.trim().slice(0, MAX_LABEL_LENGTH) : null;

  const session = await startSession(params.seasonId, user.id, label);
  if (!session) return NextResponse.json({ error: "not commissioner" }, { status: 403 });
  return NextResponse.json({ sessionId: session.id });
}
