import type { Suit, TileVal } from "@/engine/tiles";

const WIND_FILE: Record<string, string> = { E: "Ton", S: "Nan", W: "Shaa", N: "Pei" };
const DRAGON_FILE: Record<string, string> = { red: "Chun", green: "Hatsu", white: "Haku" };

/** Path under /public for the SVG face of a given tile. */
export function tileImageSrc(suit: Suit, val: TileVal): string {
  if (suit === "dots")   return `/tiles/Pin${val}.svg`;
  if (suit === "bams")   return `/tiles/Sou${val}.svg`;
  if (suit === "cracks") return `/tiles/Man${val}.svg`;
  if (suit === "wind")   return `/tiles/${WIND_FILE[val as string]}.svg`;
  if (suit === "dragon") return `/tiles/${DRAGON_FILE[val as string]}.svg`;
  if (suit === "flower") return `/tiles/Flower.svg`;
  return `/tiles/Joker.svg`;
}

/** Human-readable alt/title text for a tile. */
export function tileAltText(suit: Suit, val: TileVal): string {
  if (suit === "dots")   return `${val} Dots`;
  if (suit === "bams")   return `${val} Bams`;
  if (suit === "cracks") return `${val} Cracks`;
  if (suit === "wind") {
    const name = { E: "East", S: "South", W: "West", N: "North" }[val as string];
    return `${name} Wind`;
  }
  if (suit === "dragon") {
    const name = { red: "Red", green: "Green", white: "White" }[val as string];
    return `${name} Dragon`;
  }
  if (suit === "flower") return "Flower";
  return "Joker";
}
