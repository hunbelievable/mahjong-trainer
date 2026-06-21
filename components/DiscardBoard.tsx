"use client";

import TileFace from "./TileFace";
import type { Tile, PlayerId } from "@/engine/tiles";

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
                text-xs font-semibold w-14 shrink-0 pt-2
                ${isMe ? "text-indigo-700" : "text-gray-500"}
              `}
            >
              {SEAT_LABELS[seat]}{isMe ? " ★" : ""}
            </span>
            <div className="flex gap-1 flex-wrap min-h-8">
              {tiles.length === 0 && (
                <span className="text-xs text-gray-300 italic pt-1">—</span>
              )}
              {tiles.map(tile => (
                <TileFace
                  key={tile.id}
                  suit={tile.suit}
                  val={tile.val}
                  size="xs"
                  onClick={onRemove ? () => onRemove(tile, seat) : undefined}
                  title={onRemove ? "Click to remove" : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
