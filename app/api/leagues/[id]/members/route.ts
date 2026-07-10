// POST /api/leagues/:id/members — add a member by email. Commissioner-only.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { addMember } from "@/lib/server/league";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = (body as { email?: unknown } | null)?.email;
  if (typeof email !== "string" || email.trim().length === 0) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const ok = await addMember(params.id, user.id, email.trim().toLowerCase());
  if (!ok) return NextResponse.json({ error: "not commissioner, or already a member" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
