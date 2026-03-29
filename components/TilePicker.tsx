"use client";

import { ALL_TILE_TYPES } from "@/lib/shorthand";
import type { TileType } from "@/lib/shorthand";
import type { Suit } from "@/engine/tiles";

interface TilePickerProps {
  onPick: (tile: TileType) => void;
  /** IDs of tiles that are fully used (all copies accounted for) — shown dimmed */
  exhaustedKeys?: Set<string>;
}

const SUIT_COLORS: Record<Suit, string> = {
  dots:   "bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-300",
  bams:   "bg-green-100 hover:bg-green-200 text-green-900 border-green-300",
  cracks: "bg-red-100 hover:bg-red-200 text-red-900 border-red-300",
  wind:   "bg-yellow-100 hover:bg-yellow-200 text-yellow-900 border-yellow-300",
  dragon: "bg-purple-100 hover:bg-purple-200 text-purple-900 border-purple-300",
  flower: "bg-pink-100 hover:bg-pink-200 text-pink-900 border-pink-300",
  joker:  "bg-gray-100 hover:bg-gray-200 text-gray-900 border-gray-300",
};

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
                <button
                  key={key}
                  onClick={() => !exhausted && onPick(tile)}
                  disabled={exhausted}
                  className={`
                    px-2 py-0.5 text-xs font-mono rounded border font-semibold
                    transition-colors select-none
                    ${exhausted
                      ? "opacity-30 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-200"
                      : SUIT_COLORS[suit] + " cursor-pointer"
                    }
                  `}
                  title={exhausted ? "All copies accounted for" : `Add ${tile.label}`}
                >
                  {tile.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
