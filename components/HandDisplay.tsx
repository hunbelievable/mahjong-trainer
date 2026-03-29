"use client";

import { tileLabel } from "@/lib/shorthand";
import type { Tile, Suit } from "@/engine/tiles";

interface HandDisplayProps {
  tiles: Tile[];
  /** Tile IDs to highlight as "suggested discard" */
  suggestedDiscardIds?: Set<string>;
  /** Called when user clicks a tile (e.g. to discard it) */
  onTileClick?: (tile: Tile) => void;
  label?: string;
}

const SUIT_COLORS: Record<Suit, string> = {
  dots:   "bg-blue-100 text-blue-900 border-blue-400",
  bams:   "bg-green-100 text-green-900 border-green-400",
  cracks: "bg-red-100 text-red-900 border-red-400",
  wind:   "bg-yellow-100 text-yellow-900 border-yellow-400",
  dragon: "bg-purple-100 text-purple-900 border-purple-400",
  flower: "bg-pink-100 text-pink-900 border-pink-400",
  joker:  "bg-gray-100 text-gray-900 border-gray-400",
};

export default function HandDisplay({
  tiles,
  suggestedDiscardIds,
  onTileClick,
  label = "Hand",
}: HandDisplayProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <span className="text-xs text-gray-400">({tiles.length} tiles)</span>
      </div>
      <div className="flex gap-1 flex-wrap min-h-8">
        {tiles.length === 0 && (
          <span className="text-xs text-gray-400 italic">No tiles yet</span>
        )}
        {tiles.map(tile => {
          const isSuggested = suggestedDiscardIds?.has(tile.id);
          const baseColor = SUIT_COLORS[tile.suit];
          return (
            <button
              key={tile.id}
              onClick={() => onTileClick?.(tile)}
              className={`
                px-2 py-1 text-sm font-mono rounded border-2 font-bold
                transition-all select-none
                ${onTileClick ? "cursor-pointer hover:brightness-90" : "cursor-default"}
                ${isSuggested
                  ? "ring-2 ring-orange-400 ring-offset-1 border-orange-500 bg-orange-100 text-orange-900"
                  : baseColor
                }
              `}
              title={isSuggested ? "Suggested discard" : tile.id}
            >
              {tileLabel(tile.suit, tile.val)}
              {isSuggested && <span className="ml-0.5 text-orange-500">↓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
