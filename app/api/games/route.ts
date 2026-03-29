import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/games — create a new game session
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode = body.mode ?? "live";
    const game = await prisma.game.create({ data: { mode } });
    return NextResponse.json(game, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create game" }, { status: 500 });
  }
}

// GET /api/games — list recent games (newest first, limit 50)
export async function GET() {
  try {
    const games = await prisma.game.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        _count: { select: { moves: true } },
      },
    });
    return NextResponse.json(games);
  } catch {
    return NextResponse.json({ error: "Failed to fetch games" }, { status: 500 });
  }
}
