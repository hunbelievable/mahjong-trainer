"use client";

import { ALL_TILE_TYPES } from "@/lib/shorthand";
import type { TileType } from "@/lib/shorthand";
import type { Suit } from "@/engine/tiles";
import TileFace from "./TileFace";

interface TilePickerProps {
  onPick: (tile: TileType) => void;
  /** IDs of tiles that are fully used (all copies accounted for) — shown dimmed */
  exhaustedKeys?: Set<string>;
}

const SUIT_LABELS: Record<Suit, string> = {
  dots:   "Dots",
  bams:   "Bams",
  cracks: "Cracks",
  wind:   "Winds",
  dragon: "Dragons",
  flower: "Flowers",
  joker:  "Jokers",
};

const SUIT_ORDER: Suit[] = ["dots", "bams", "cracks", "wind", "dragon", "flower", "joker"];

export default function TilePicker({ onPick, exhaustedKeys }: TilePickerProps) {
  const bySection = SUIT_ORDER.map(suit => ({
    suit,
    tiles: ALL_TILE_TYPES.filter(t => t.suit === suit),
  }));

  return (
    <div className="space-y-2">
      {bySection.map(({ suit, tiles }) => (
        <div key={suit} className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 w-16 shrink-0">{SUIT_LABELS[suit]}</span>
          <div className="flex gap-1 flex-wrap">
            {tiles.map(tile => {
              const key = `${tile.suit}:${tile.val}`;
              const exhausted = exhaustedKeys?.has(key);
              return (
                <TileFace
                  key={key}
                  suit={tile.suit}
                  val={tile.val}
                  size="sm"
                  dimmed={exhausted}
                  onClick={exhausted ? undefined : () => onPick(tile)}
                  title={exhausted ? "All copies accounted for" : `Add ${tile.label}`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
