import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PATTERNS } from "@/engine/patterns";
import type { PatternGroup } from "@/engine/patterns";

// Auto-seed built-in patterns if the table is empty
async function seedIfEmpty() {
  const count = await prisma.handPattern.count();
  if (count > 0) return;
  await prisma.handPattern.createMany({
    data: PATTERNS.map(p => ({
      id: p.id,
      name: p.name,
      difficulty: p.difficulty,
      description: p.description,
      groups: JSON.stringify(p.groups),
      builtIn: true,
      active: true,
    })),
  });
}

export async function GET() {
  try {
    await seedIfEmpty();
    const patterns = await prisma.handPattern.findMany({
      where: { active: true },
      orderBy: [{ difficulty: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(patterns.map(p => ({
      ...p,
      groups: JSON.parse(p.groups) as PatternGroup[],
    })));
  } catch {
    return NextResponse.json({ error: "Failed to fetch patterns" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, difficulty, description, groups } = body;
    if (!name || !difficulty || !groups?.length) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const totalTiles = (groups as PatternGroup[]).reduce((s: number, g: PatternGroup) => s + g.count, 0);
    if (totalTiles !== 14) {
      return NextResponse.json({ error: `Groups total ${totalTiles} tiles, must be 14` }, { status: 400 });
    }
    const pattern = await prisma.handPattern.create({
      data: {
        name,
        difficulty,
        description: description ?? "",
        groups: JSON.stringify(groups),
        builtIn: false,
        active: true,
      },
    });
    return NextResponse.json({ ...pattern, groups: JSON.parse(pattern.groups) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create pattern" }, { status: 500 });
  }
}
