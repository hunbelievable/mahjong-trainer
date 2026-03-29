import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export interface SaveMovePayload {
  turn: number;
  player: string;
  action: string;        // 'discard' | 'draw' | 'claim_pung' | 'claim_kong' | 'flower_reveal' | 'declare_mahjong'
  tileId: string;
  handBefore: string[];  // ordered tile IDs
  winProbBefore: number;
  winProbAfter: number;
  commentary?: string;
  tileEvents?: Array<{
    tileId: string;
    fromState: string;
    toState: string;
    actor: string;
  }>;
}

// POST /api/games/[id]/moves — record a move in a game
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body: SaveMovePayload = await req.json();

    const move = await prisma.moveRecord.create({
      data: {
        gameId:        params.id,
        turn:          body.turn,
        player:        body.player,
        action:        body.action,
        tileId:        body.tileId,
        handBefore:    JSON.stringify(body.handBefore),
        winProbBefore: body.winProbBefore,
        winProbAfter:  body.winProbAfter,
        commentary:    body.commentary ?? null,
        tileEvents: body.tileEvents?.length
          ? {
              create: body.tileEvents.map(e => ({
                tileId:    e.tileId,
                fromState: e.fromState,
                toState:   e.toState,
                actor:     e.actor,
              })),
            }
          : undefined,
      },
      include: { tileEvents: true },
    });

    return NextResponse.json(move, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to save move" }, { status: 500 });
  }
}
