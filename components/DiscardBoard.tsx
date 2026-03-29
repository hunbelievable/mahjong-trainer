"use client";

import { tileLabel } from "@/lib/shorthand";
import type { Tile, PlayerId, Suit } from "@/engine/tiles";

interface DiscardBoardProps {
  discards: Record<PlayerId, Tile[]>;
  myPosition: PlayerId;
  /** Called when user clicks a discard tile to remove it */
  onRemove?: (tile: Tile, player: PlayerId) => void;
}

const SEAT_LABELS: Record<PlayerId, string> = {
  E: "East",
  S: "South",
  W: "West",
  N: "North",
};

const SUIT_COLORS: Record<Suit, string> = {
  dots:   "bg-blue-100 text-blue-800",
  bams:   "bg-green-100 text-green-800",
  cracks: "bg-red-100 text-red-800",
  wind:   "bg-yellow-100 text-yellow-800",
  dragon: "bg-purple-100 text-purple-800",
  flower: "bg-pink-100 text-pink-800",
  joker:  "bg-gray-100 text-gray-800",
};

const SEAT_ORDER: PlayerId[] = ["E", "S", "W", "N"];

export default function DiscardBoard({
  discards,
  myPosition,
  onRemove,
}: DiscardBoardProps) {
  return (
    <div className="space-y-2">
      {SEAT_ORDER.map(seat => {
        const tiles = discards[seat];
        const isMe = seat === myPosition;
        return (
          <div key={seat} className="flex gap-2 items-start">
            <span
              className={`
                text-xs font-semibold w-14 shrink-0 pt-1
                ${isMe ? "text-indigo-700" : "text-gray-500"}
              `}
            >
              {SEAT_LABELS[seat]}{isMe ? " ★" : ""}
            </span>
            <div className="flex gap-0.5 flex-wrap min-h-6">
              {tiles.length === 0 && (
                <span className="text-xs text-gray-300 italic pt-0.5">—</span>
              )}
              {tiles.map(tile => (
                <button
                  key={tile.id}
                  onClick={() => onRemove?.(tile, seat)}
                  className={`
                    px-1.5 py-0 text-xs font-mono rounded font-medium
                    ${SUIT_COLORS[tile.suit]}
                    ${onRemove ? "cursor-pointer hover:opacity-70" : "cursor-default"}
                  `}
                  title={onRemove ? "Click to remove" : tile.id}
                >
                  {tileLabel(tile.suit, tile.val)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
