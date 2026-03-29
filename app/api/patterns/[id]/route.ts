import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PatternGroup } from "@/engine/patterns";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, difficulty, description, groups } = body;
    if (groups) {
      const totalTiles = (groups as PatternGroup[]).reduce((s: number, g: PatternGroup) => s + g.count, 0);
      if (totalTiles !== 14) {
        return NextResponse.json({ error: `Groups total ${totalTiles} tiles, must be 14` }, { status: 400 });
      }
    }
    const pattern = await prisma.handPattern.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(difficulty && { difficulty }),
        ...(description !== undefined && { description }),
        ...(groups && { groups: JSON.stringify(groups) }),
      },
    });
    return NextResponse.json({ ...pattern, groups: JSON.parse(pattern.groups) });
  } catch {
    return NextResponse.json({ error: "Failed to update pattern" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const pattern = await prisma.handPattern.findUnique({ where: { id } });
    if (!pattern) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Soft-delete built-ins, hard-delete custom ones
    if (pattern.builtIn) {
      await prisma.handPattern.update({ where: { id }, data: { active: false } });
    } else {
      await prisma.handPattern.delete({ where: { id } });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete pattern" }, { status: 500 });
  }
}
