"use client";

import TileFace from "./TileFace";
import type { Tile } from "@/engine/tiles";

interface HandDisplayProps {
  tiles: Tile[];
  /** Tile IDs to highlight as "suggested discard" */
  suggestedDiscardIds?: Set<string>;
  /** Tile ID just drawn from the wall — outlined to make it easy to spot. */
  freshTileId?: string;
  /** Called when user clicks a tile (e.g. to discard it) */
  onTileClick?: (tile: Tile) => void;
  label?: string;
}

export default function HandDisplay({
  tiles,
  suggestedDiscardIds,
  freshTileId,
  onTileClick,
  label = "Hand",
}: HandDisplayProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <span className="text-xs text-gray-400">({tiles.length} tiles)</span>
        {freshTileId && (
          <span className="text-[10px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-300 rounded px-1.5 py-0.5">
            ◆ just drawn
          </span>
        )}
      </div>
      <div className="flex gap-1 flex-wrap min-h-12">
        {tiles.length === 0 && (
          <span className="text-xs text-gray-400 italic">No tiles yet</span>
        )}
        {tiles.map(tile => {
          const isFresh = tile.id === freshTileId;
          return (
            <div
              key={tile.id}
              className={
                isFresh
                  ? "relative rounded-md ring-2 ring-cyan-400 ring-offset-1 p-0.5"
                  : undefined
              }
            >
              <TileFace
                suit={tile.suit}
                val={tile.val}
                size="sm"
                highlighted={suggestedDiscardIds?.has(tile.id)}
                onClick={onTileClick ? () => onTileClick(tile) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
