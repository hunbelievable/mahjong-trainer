"use client";

import type { EvalResult } from "@/engine/evaluator";
import type { Tile } from "@/engine/tiles";
import type { PatternGroup } from "@/engine/patterns";
import { tileLabel } from "@/lib/shorthand";

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

function GroupDots({ natural, jokerFill, needed, total }: {
  natural: number; jokerFill: number; needed: number; total: number;
}) {
  return (
    <div className="flex gap-0.5 items-center">
      {Array.from({ length: total }).map((_, i) => {
        const isNatural = i < natural;
        const isJoker   = i >= natural && i < natural + jokerFill;
        const isEmpty   = i >= natural + jokerFill;
        return (
          <span
            key={i}
            className={`
              inline-block w-3 h-3 rounded-full border
              ${isNatural ? "bg-emerald-500 border-emerald-600" : ""}
              ${isJoker   ? "bg-yellow-400 border-yellow-500"   : ""}
              ${isEmpty   ? "bg-white border-gray-300"          : ""}
            `}
            title={isJoker ? "Joker" : isNatural ? "Matched" : "Needed"}
          />
        );
      })}
    </div>
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

  // Show top 2 patterns at best shanten
  const topPatterns = evalResult.bestPatterns.slice(0, 2);

  return (
    <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Pattern Progress
      </div>

      {topPatterns.map((match, pi) => {
        const progress = computeGroupProgress(hand, match.pattern.groups);
        const completedGroups = progress.filter(p => p.needed === 0).length;
        const totalGroups = progress.length;

        return (
          <div key={match.pattern.id} className="p-3 space-y-2">
            {/* Pattern header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">
                  {match.pattern.name}
                </span>
                {pi === 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">
                    Best
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-500">
                {completedGroups}/{totalGroups} groups
              </span>
            </div>

            {/* Group rows */}
            <div className="space-y-1.5">
              {progress.map((p, gi) => {
                const isComplete = p.needed === 0;
                const isEmpty    = p.natural === 0 && p.jokerFill === 0;
                const rowColor   = isComplete ? "text-emerald-700" : isEmpty ? "text-gray-400" : "text-yellow-700";

                return (
                  <div key={gi} className="flex items-center gap-2">
                    {/* Group label */}
                    <span className={`text-xs font-mono w-16 shrink-0 ${rowColor}`}>
                      {p.group.count}× {tileLabel(p.group.suit, p.group.val)}
                      {p.group.jokerLocked ? " 🔒" : ""}
                    </span>

                    {/* Progress dots */}
                    <GroupDots
                      natural={p.natural}
                      jokerFill={p.jokerFill}
                      needed={p.needed}
                      total={p.group.count}
                    />

                    {/* Status */}
                    <span className={`text-xs ml-auto shrink-0 ${rowColor}`}>
                      {isComplete
                        ? "✓"
                        : `${p.needed} more`
                      }
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Legend (only on first pattern) */}
            {pi === 0 && (
              <div className="flex gap-3 pt-1 border-t border-gray-50">
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Natural
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> Joker
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-white border border-gray-300 inline-block" /> Needed
                </div>
              </div>
            )}
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
