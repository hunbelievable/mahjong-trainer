// =============================================================================
// PATCH /api/user — set or clear the caller's multiplayer display handle.
//
// Unlike /api/rooms*, this is a normal Next.js Route Handler, not raw
// server.ts plumbing: it only touches Prisma (via lib/prisma.ts's singleton),
// which is DB-backed and has no meaningful in-process-singleton concern the
// way roomManager/wsHub do (see lib/server/roomApi.ts's header comment for
// why THAT module needed special handling). currentUser() also works fine
// here since Route Handlers run inside Next's own request lifecycle, unlike
// server.ts's raw IncomingMessage path.
// =============================================================================

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/currentUser";
import { prisma } from "@/lib/prisma";

const MAX_HANDLE_LENGTH = 24;

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const raw = (body as { handle?: unknown } | null)?.handle;
  if (typeof raw !== "string") return NextResponse.json({ error: "handle required" }, { status: 400 });

  const trimmed = raw.trim().slice(0, MAX_HANDLE_LENGTH);
  const handle = trimmed.length > 0 ? trimmed : null; // empty string clears the handle

  await prisma.user.update({ where: { id: user.id }, data: { handle } });
  return NextResponse.json({ handle });
}
