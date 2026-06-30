"use client";

import { tileImageSrc, tileAltText } from "@/lib/tileAssets";
import { tileLabel } from "@/lib/shorthand";
import type { Suit, TileVal } from "@/engine/tiles";

export type TileFaceSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASSES: Record<TileFaceSize, string> = {
  xs: "w-6 h-8",
  sm: "w-9 h-12",
  md: "w-11 h-14",
  lg: "w-14 h-20",
};

/** Per-size font sizing for the corner index badge on cracks/winds. */
const BADGE_CLASSES: Record<TileFaceSize, string> = {
  xs: "text-[7px] top-0 left-0.5",
  sm: "text-[9px] top-0 left-0.5",
  md: "text-[10px] top-0 left-1",
  lg: "text-[12px] top-0.5 left-1",
};

/** The little corner index — like the pip in the corner of a playing card. Every tile gets one. */
function cornerIndex(suit: Suit, val: TileVal): { text: string; color: string } | null {
  if (suit === "dots")   return { text: String(val), color: "text-blue-800" };
  if (suit === "bams")   return { text: String(val), color: "text-green-700" };
  if (suit === "cracks") return { text: String(val), color: "text-red-700" };
  if (suit === "wind")   return { text: String(val), color: "text-blue-800" };
  if (suit === "dragon") {
    if (val === "red")   return { text: "R", color: "text-red-700" };
    if (val === "green") return { text: "G", color: "text-green-700" };
    if (val === "white") return null; // soap — leave it unbadged
  }
  if (suit === "flower") return { text: "F", color: "text-pink-600" };
  if (suit === "joker")  return { text: "J", color: "text-purple-700" };
  return null;
}

interface TileFaceProps {
  suit: Suit;
  val: TileVal;
  size?: TileFaceSize;
  highlighted?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  title?: string;
}

export default function TileFace({
  suit,
  val,
  size = "sm",
  highlighted = false,
  dimmed = false,
  onClick,
  title,
}: TileFaceProps) {
  const src = tileImageSrc(suit, val);
  const alt = tileAltText(suit, val);
  const tooltip = title ?? `${alt} (${tileLabel(suit, val)})`;
  const interactive = !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      title={tooltip}
      aria-label={alt}
      className={`
        ${SIZE_CLASSES[size]}
        relative inline-flex items-center justify-center
        rounded-md border bg-white p-0.5
        shadow-[0_1px_0_#bdb39a,0_2px_3px_rgba(0,0,0,0.18)]
        transition-transform select-none
        ${interactive ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_2px_0_#bdb39a,0_4px_6px_rgba(0,0,0,0.22)]" : "cursor-default"}
        ${highlighted
          ? "border-orange-500 ring-2 ring-orange-400 ring-offset-1"
          : "border-stone-300"}
        ${dimmed ? "opacity-40" : ""}
      `}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" draggable={false} className="max-w-full max-h-full object-contain pointer-events-none" />
      {(() => {
        const idx = cornerIndex(suit, val);
        if (!idx) return null;
        return (
          <span
            aria-hidden="true"
            className={`absolute ${BADGE_CLASSES[size]} ${idx.color} font-bold leading-none pointer-events-none drop-shadow-[0_0_2px_rgba(255,255,255,0.95)]`}
          >
            {idx.text}
          </span>
        );
      })()}
      {highlighted && (
        <span className="absolute -top-2 -right-1 text-[10px] text-orange-600 font-bold">↓</span>
      )}
    </button>
  );
}
