"use client";

import type { EvalResult } from "@/engine/evaluator";
import type { Tile } from "@/engine/tiles";
import type { PatternGroup } from "@/engine/patterns";
import TileFace from "./TileFace";

interface PatternTrackerProps {
  hand: Tile[];
  evalResult: EvalResult | null;
}

interface GroupProgress {
  group: PatternGroup;
  natural: number;   // natural tiles matched
  jokerFill: number; // joker slots used
  needed: number;    // still required
}

function computeGroupProgress(hand: Tile[], groups: PatternGroup[]): GroupProgress[] {
  const freq = new Map<string, number>();
  let jokers = 0;
  for (const tile of hand) {
    if (tile.suit === "joker") { jokers++; continue; }
    const key = `${tile.suit}:${tile.val}`;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  let jokersUsed = 0;
  return groups.map(group => {
    const key = `${group.suit}:${group.val}`;
    const inHand = freq.get(key) ?? 0;
    const natural = Math.min(inHand, group.count);
    freq.set(key, inHand - natural);

    const deficit = group.count - natural;
    let jokerFill = 0;
    if (deficit > 0 && !group.jokerLocked) {
      jokerFill = Math.min(deficit, jokers - jokersUsed);
      jokersUsed += jokerFill;
    }

    return { group, natural, jokerFill, needed: deficit - jokerFill };
  });
}

/**
 * Render one group's target tiles, styled by match state:
 *   - natural matches → normal tile
 *   - joker-filled slots → a joker tile
 *   - still-needed slots → dimmed (ghosted) target tile
 */
function GroupTiles({ group, natural, jokerFill }: GroupProgress) {
  return (
    <span className="inline-flex gap-0.5 items-center">
      {Array.from({ length: group.count }).map((_, i) => {
        if (i < natural) {
          return <TileFace key={i} suit={group.suit} val={group.val} size="xs" />;
        }
        if (i < natural + jokerFill) {
          return <TileFace key={i} suit="joker" val="joker" size="xs" />;
        }
        return <TileFace key={i} suit={group.suit} val={group.val} size="xs" dimmed />;
      })}
    </span>
  );
}

export default function PatternTracker({ hand, evalResult }: PatternTrackerProps) {
  if (!evalResult || hand.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-400 italic">
        Add tiles to track pattern progress.
      </div>
    );
  }

  const patterns = evalResult.bestPatterns;

  if (patterns.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-400 italic">
        No viable patterns for this hand.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Viable Patterns
        </span>
        <div className="flex gap-3">
          <span className="flex items-center gap-1 text-[10px] text-gray-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-stone-300 inline-block" /> Have
          </span>
          <span className="flex items-center gap-1 text-[10px] text-gray-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-purple-200 border border-purple-300 inline-block" /> Joker
          </span>
          <span className="flex items-center gap-1 text-[10px] text-gray-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-white border border-gray-300 opacity-40 inline-block" /> Needed
          </span>
        </div>
      </div>

      {patterns.map((match, pi) => {
        const progress = computeGroupProgress(hand, match.pattern.groups);
        const completedGroups = progress.filter(p => p.needed === 0).length;
        const totalGroups = progress.length;

        return (
          <div key={`${match.pattern.id}-${pi}`} className="p-3 space-y-2">
            {/* Pattern header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-gray-800 truncate">
                  {match.pattern.name}
                </span>
                {pi === 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold shrink-0">
                    Best
                  </span>
                )}
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold shrink-0">
                  {match.pattern.value} pts
                </span>
              </div>
              <span className="text-xs text-gray-500 shrink-0">
                {match.tilesMatched}/14 · {completedGroups}/{totalGroups} groups
              </span>
            </div>

            {/* Target tiles, styled by match state */}
            <div className="flex flex-wrap gap-1.5 items-center">
              {progress.map((p, gi) => (
                <GroupTiles key={gi} {...p} />
              ))}
            </div>
          </div>
        );
      })}

      {evalResult.shanten === -1 && (
        <div className="p-3 text-center text-sm font-bold text-emerald-600">
          Hand complete ✓
        </div>
      )}
    </div>
  );
}
