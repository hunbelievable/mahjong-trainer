"use client";

import TileFace from "./TileFace";
import type { Tile } from "@/engine/tiles";

interface HandDisplayProps {
  tiles: Tile[];
  /** Tile IDs to highlight as "suggested discard" */
  suggestedDiscardIds?: Set<string>;
  /** Called when user clicks a tile (e.g. to discard it) */
  onTileClick?: (tile: Tile) => void;
  label?: string;
}

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
      <div className="flex gap-1 flex-wrap min-h-12">
        {tiles.length === 0 && (
          <span className="text-xs text-gray-400 italic">No tiles yet</span>
        )}
        {tiles.map(tile => (
          <TileFace
            key={tile.id}
            suit={tile.suit}
            val={tile.val}
            size="sm"
            highlighted={suggestedDiscardIds?.has(tile.id)}
            onClick={onTileClick ? () => onTileClick(tile) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
