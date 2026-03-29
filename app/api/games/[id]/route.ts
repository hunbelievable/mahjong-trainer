import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/games/[id] — fetch a single game with all its moves
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const game = await prisma.game.findUnique({
      where: { id: params.id },
      include: {
        moves: {
          orderBy: { turn: "asc" },
          include: { tileEvents: true },
        },
      },
    });
    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }
    return NextResponse.json(game);
  } catch {
    return NextResponse.json({ error: "Failed to fetch game" }, { status: 500 });
  }
}

// PATCH /api/games/[id] — update game (mark finished, set winner)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const game = await prisma.game.update({
      where: { id: params.id },
      data: {
        finishedAt: body.finishedAt ? new Date(body.finishedAt) : undefined,
        winner: body.winner ?? undefined,
      },
    });
    return NextResponse.json(game);
  } catch {
    return NextResponse.json({ error: "Failed to update game" }, { status: 500 });
  }
}
