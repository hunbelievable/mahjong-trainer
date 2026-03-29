"use client";

import type { EvalResult } from "@/engine/evaluator";
import { tileLabel } from "@/lib/shorthand";

interface EvalPanelProps {
  result: EvalResult | null;
  handSize: number;
}

function ShantenBadge({ shanten }: { shanten: number }) {
  if (shanten === -1) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500 text-white">
        Mahjong!
      </span>
    );
  }
  if (shanten === 0) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-400 text-yellow-900">
        Tenpai
      </span>
    );
  }
  const color =
    shanten <= 2 ? "bg-orange-100 text-orange-800" : "bg-gray-100 text-gray-700";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
      {shanten} away
    </span>
  );
}

function WinProbBar({ prob }: { prob: number }) {
  const pct = Math.round(prob * 100);
  const color =
    pct >= 50 ? "bg-emerald-500" :
    pct >= 20 ? "bg-yellow-400" :
    "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-gray-700 w-10 text-right">{pct}%</span>
    </div>
  );
}

export default function EvalPanel({ result, handSize }: EvalPanelProps) {
  if (!result) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-400 italic">
        Add tiles to your hand to see analysis.
      </div>
    );
  }

  const bestPattern = result.bestPatterns[0];

  return (
    <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">

      {/* Shanten + Pattern */}
      <div className="p-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShantenBadge shanten={result.shanten} />
            {result.shanten >= 0 && (
              <span className="text-xs text-gray-500">
                Best: <span className="font-semibold text-gray-700">
                  {bestPattern?.pattern.name ?? "—"}
                </span>
              </span>
            )}
          </div>
          {result.bestPatterns.length > 1 && (
            <div className="text-xs text-gray-400 mt-0.5">
              +{result.bestPatterns.length - 1} other pattern{result.bestPatterns.length > 2 ? "s" : ""}
            </div>
          )}
        </div>
        <div className="text-xs text-gray-400">{handSize} tiles</div>
      </div>

      {/* Win probability */}
      {result.shanten >= 0 && (
        <div className="p-3">
          <div className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
            Win probability
          </div>
          <WinProbBar prob={result.winProbability} />
          <div className="text-xs text-gray-400 mt-1">
            {result.totalOuts} live out{result.totalOuts !== 1 ? "s" : ""} · wall ~{result.liveWallSize} tiles
          </div>
        </div>
      )}

      {/* Outs */}
      {result.outs.length > 0 && (
        <div className="p-3">
          <div className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
            Outs
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {result.outs
              .sort((a, b) => b.liveCount - a.liveCount)
              .map(out => (
                <span
                  key={`${out.suit}:${out.val}`}
                  className="px-1.5 py-0.5 text-xs font-mono rounded bg-indigo-50 text-indigo-800 border border-indigo-200"
                >
                  {tileLabel(out.suit, out.val)}
                  <span className="ml-0.5 text-indigo-400">×{out.liveCount}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* All patterns at best shanten (collapsed if only 1) */}
      {result.bestPatterns.length > 1 && (
        <div className="p-3">
          <div className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
            Viable patterns
          </div>
          <div className="space-y-0.5">
            {result.bestPatterns.map(m => (
              <div key={m.pattern.id} className="flex items-center justify-between text-xs">
                <span className="text-gray-700">{m.pattern.name}</span>
                <span className="text-gray-400">{m.tilesMatched}/14 matched</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pattern description */}
      {bestPattern && result.shanten >= 0 && (
        <div className="p-3">
          <div className="text-xs text-gray-500 italic leading-relaxed">
            {bestPattern.pattern.description}
          </div>
        </div>
      )}
    </div>
  );
}
