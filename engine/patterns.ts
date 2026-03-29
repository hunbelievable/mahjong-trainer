import type { Suit, TileVal, SuitedVal, WindVal, DragonVal } from "./tiles";

// =============================================================================
// Concrete types (used by evaluator internally)
// =============================================================================

export interface PatternGroup {
  suit: Suit;
  val: TileVal;
  count: 1 | 2 | 3 | 4 | 5;   // 1 = single tile (Singles & Pairs section)
  jokerLocked?: boolean;
}

export interface HandPattern {
  id: string;
  name: string;
  description: string;
  difficulty: "starter" | "medium" | "hard";
  groups: PatternGroup[];
  totalTiles: number;
}

// =============================================================================
// Template types (flexible NMJL notation)
// =============================================================================

/**
 * Suit slots:
 *   SA / SB / SC — free variable chosen from { dots, bams, cracks }
 *   Fixed suits   — dots, bams, cracks, wind, dragon, flower, joker
 *
 * When a template has suitMode "3suits":  SA ≠ SB ≠ SC (all permutations of the 3 suited suits)
 * When "2suits":  SA ≠ SB (6 ordered pairs from 3 suited suits)
 * When "1suit":   SA = SB = SC (3 choices, one per suited suit)
 * When "none":    no suited-suit variables (no permutations needed)
 */
export type SuitVar = "SA" | "SB" | "SC";
export type SuitSpec = Suit | SuitVar;

/**
 * Value slots:
 *   TileVal             — fixed value
 *   { v: number }       — V + offset, where V is the free integer variable
 *                          v=0 → V itself,  v=1 → V+1,  v=2 → V+2 …
 *   "ZERO"              — white dragon (NMJL rule: white dragon = 0)
 *   "DRAGON_ANY"        — any one dragon color (red/green/white); creates 3 instantiations
 *
 * Wind variable: use { windVar: true } on a group with suit "wind" to mean "any one wind value".
 */
export type ValSpec = TileVal | { v: number } | "ZERO" | "DRAGON_ANY";

/**
 * suitMode: how many distinct suited-suit variables appear in the template.
 * Used to generate suit assignments.
 */
export type SuitMode = "1suit" | "2suits" | "3suits" | "none";

/**
 * valMode: what values the free integer variable V can take.
 * Required whenever any group has val: { v: number }.
 */
export type ValMode =
  | { kind: "fixed" }                    // no variable V
  | { kind: "any" }                      // V ∈ 1–9
  | { kind: "even" }                     // V ∈ { 2, 4, 6, 8 }
  | { kind: "odd" }                      // V ∈ { 1, 3, 5, 7, 9 }
  | { kind: "consec"; len: number };     // V, V+1, …, V+len-1 all in 1–9  (V ∈ 1 .. 10-len)

export interface TemplateGroup {
  suit: SuitSpec;
  val: ValSpec;
  count: 1 | 2 | 3 | 4 | 5;
  jokerLocked?: boolean;
  /** If true, treat suit as "any wind value" at instantiation time (iterates E/S/W/N). */
  windVar?: boolean;
}

export interface HandPatternTemplate {
  id: string;
  name: string;
  /** Card section name */
  section: string;
  difficulty: "starter" | "medium" | "hard";
  /** Point value from the card */
  value: number;
  description: string;
  /** Singles & Pairs hands may not have exposed melds */
  closed?: boolean;
  groups: TemplateGroup[];
  /** Alternate group set for "X or Y" patterns */
  altGroups?: TemplateGroup[];
  suitMode: SuitMode;
  valMode: ValMode;
}

// =============================================================================
// Instantiator: template  →  HandPattern[]
// =============================================================================

const SUITED_SUITS: Suit[] = ["dots", "bams", "cracks"];
const WIND_VALS: WindVal[] = ["E", "S", "W", "N"];
const DRAGON_VALS: DragonVal[] = ["red", "green", "white"];

/** All assignments of SA/SB/SC given a suitMode. */
function suitAssignments(mode: SuitMode): Array<Record<SuitVar, Suit>> {
  const dummy: Record<SuitVar, Suit> = { SA: "dots", SB: "bams", SC: "cracks" };
  if (mode === "none") return [dummy];

  if (mode === "1suit") {
    return SUITED_SUITS.map(s => ({ SA: s, SB: s, SC: s }));
  }
  if (mode === "2suits") {
    const out: Array<Record<SuitVar, Suit>> = [];
    for (const a of SUITED_SUITS) {
      for (const b of SUITED_SUITS) {
        if (a !== b) out.push({ SA: a, SB: b, SC: a }); // SC unused / same as SA
      }
    }
    return out;
  }
  // "3suits" — all 6 permutations
  const out: Array<Record<SuitVar, Suit>> = [];
  for (const a of SUITED_SUITS) {
    for (const b of SUITED_SUITS) {
      for (const c of SUITED_SUITS) {
        if (a !== b && b !== c && a !== c) out.push({ SA: a, SB: b, SC: c });
      }
    }
  }
  return out;
}

/** All values V can take given valMode. Returns [0] for "fixed" (V unused). */
function valCandidates(mode: ValMode): number[] {
  if (mode.kind === "fixed") return [0];
  if (mode.kind === "any") return [1,2,3,4,5,6,7,8,9];
  if (mode.kind === "even") return [2,4,6,8];
  if (mode.kind === "odd") return [1,3,5,7,9];
  // consec: V can range from 1 to 10-len
  const out: number[] = [];
  for (let v = 1; v <= 10 - mode.len; v++) out.push(v);
  return out;
}

function resolveSuit(spec: SuitSpec, map: Record<SuitVar, Suit>): Suit {
  if (spec === "SA" || spec === "SB" || spec === "SC") return map[spec];
  return spec as Suit;
}

function resolveVal(spec: ValSpec, V: number, dragonAssign: DragonVal): TileVal | null {
  if (spec === "ZERO") return "white" as TileVal;
  if (spec === "DRAGON_ANY") return dragonAssign as TileVal;
  if (typeof spec === "object" && "v" in spec) {
    const n = V + spec.v;
    if (n < 1 || n > 9) return null; // out of range
    return n as TileVal;
  }
  return spec as TileVal;
}

/**
 * Expand a TemplateGroup[] into concrete PatternGroup[].
 * windVar groups use windAssign; DRAGON_ANY groups use dragonAssign.
 * Returns null if any value is out of range.
 */
function instantiateGroups(
  groups: TemplateGroup[],
  suitMap: Record<SuitVar, Suit>,
  V: number,
  windAssign: WindVal,
  dragonAssign: DragonVal
): PatternGroup[] | null {
  const concrete: PatternGroup[] = [];
  for (const g of groups) {
    const suit = resolveSuit(g.suit, suitMap);
    const val = g.windVar ? windAssign : resolveVal(g.val, V, dragonAssign);
    if (val === null) return null;
    concrete.push({ suit, val, count: g.count, jokerLocked: g.jokerLocked });
  }
  return concrete;
}

export function instantiateTemplate(template: HandPatternTemplate): HandPattern[] {
  const suits = suitAssignments(template.suitMode);
  const vals = valCandidates(template.valMode);
  const groupSets: TemplateGroup[][] = [template.groups];
  if (template.altGroups) groupSets.push(template.altGroups);

  const hasWindVar = groupSets.some(gs => gs.some(g => g.windVar));
  const windIter: WindVal[] = hasWindVar ? WIND_VALS : ["E"];

  const hasDragonAny = groupSets.some(gs => gs.some(g => g.val === "DRAGON_ANY"));
  const dragonIter: DragonVal[] = hasDragonAny ? DRAGON_VALS : ["red"];

  const seen = new Set<string>();
  const results: HandPattern[] = [];

  for (const suitMap of suits) {
    for (const V of vals) {
      for (const windAssign of windIter) {
        for (const dragonAssign of dragonIter) {
        for (let gi = 0; gi < groupSets.length; gi++) {
          const concrete = instantiateGroups(groupSets[gi], suitMap, V, windAssign, dragonAssign);
          if (!concrete) continue;

          // Dedup: normalise key by sorting groups
          const key = concrete
            .map(g => `${g.suit}:${String(g.val)}:${g.count}:${g.jokerLocked ? "L" : ""}`)
            .sort()
            .join("|");
          if (seen.has(key)) continue;
          seen.add(key);

          const totalTiles = concrete.reduce((s, g) => s + g.count, 0);
          results.push({
            id: `${template.id}_${results.length}`,
            name: template.name,
            description: template.description,
            difficulty: template.difficulty,
            groups: concrete,
            totalTiles,
          });
        }
        } // dragonIter
      }
    }
  }
  return results;
}

// =============================================================================
// Pattern library — NMJL 2025 Official Card
// Encoded from card photos. Tile counts verified to 14.
// NOTE: Some patterns have been interpreted from card images; use /patterns
//       page to correct any discrepancies.
// =============================================================================

export const PATTERNS: HandPatternTemplate[] = [

  // ── 2025 ───────────────────────────────────────────────────────────────────
  // FFFF 2025 222 222 (Any 3 Suits) × 25
  // 2025 = two 2s (SA) + white dragon (0) + 5 (SA)
  {
    id: "2025_ffff_year_pp",
    name: "2025: FFFF 2025 222 222",
    section: "2025",
    difficulty: "medium",
    value: 25,
    description: "FFFF 2025 222 222 — any 3 suits, like pungs of 2s or 5s in opp suits",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower",  val: "flower",              count: 4, jokerLocked: true },
      { suit: "SA",      val: 2 as SuitedVal,        count: 2 },
      { suit: "dragon",  val: "white" as DragonVal,  count: 1 },
      { suit: "SA",      val: 5 as SuitedVal,        count: 1 },
      { suit: "SB",      val: 2 as SuitedVal,        count: 3 },
      { suit: "SC",      val: 2 as SuitedVal,        count: 3 },
    ],
  },

  // FFF 0000 222 5555 (Any 2 Suits) × 25
  {
    id: "2025_fff_zero_p_k",
    name: "2025: FFF 0000 222 5555",
    section: "2025",
    difficulty: "medium",
    value: 25,
    description: "FFF 0000 222 5555 — any 2 suits",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower", val: "flower" as TileVal,  count: 3, jokerLocked: true },
      { suit: "dragon", val: "white" as DragonVal, count: 4 },
      { suit: "SA",     val: 2 as SuitedVal,       count: 3 },
      { suit: "SB",     val: 5 as SuitedVal,       count: 4 },
    ],
  },

  // 2025 222 555 DDDD (Any 3 Suits) × 25
  {
    id: "2025_year_p_p_k",
    name: "2025: 2025 222 555 DDDD",
    section: "2025",
    difficulty: "medium",
    value: 25,
    description: "2025 222 555 DDDD — any 3 suits, any dragon kong",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA",     val: 2 as SuitedVal,       count: 2 },
      { suit: "dragon", val: "white" as DragonVal, count: 1 },
      { suit: "SA",     val: 5 as SuitedVal,       count: 1 },
      { suit: "SB",     val: 2 as SuitedVal,       count: 3 },
      { suit: "SC",     val: 5 as SuitedVal,       count: 3 },
      { suit: "dragon", val: "DRAGON_ANY",          count: 4 },
    ],
  },

  // FF 222 000 222 555 (Any 3 Suits) × 30
  {
    id: "2025_ff_p_zero_p_p",
    name: "2025: FF 222 000 222 555",
    section: "2025",
    difficulty: "medium",
    value: 30,
    description: "FF 222 000 222 555 — any 3 suits",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower",  val: "flower",              count: 2, jokerLocked: true },
      { suit: "SA",      val: 2 as SuitedVal,        count: 3 },
      { suit: "dragon",  val: "white" as DragonVal,  count: 3 },
      { suit: "SB",      val: 2 as SuitedVal,        count: 3 },
      { suit: "SC",      val: 5 as SuitedVal,        count: 3 },
    ],
  },

  // ── 2468 ───────────────────────────────────────────────────────────────────
  // 222 4444 666 8888 or 222 4444 6666 888 (Any 1 or 2 Suits) × 25
  // 1-suit variant
  {
    id: "2468_p_k_p_k",
    name: "2468: 222 4444 666 8888",
    section: "2468",
    difficulty: "starter",
    value: 25,
    description: "222 4444 666 8888 or 222 4444 6666 888 — any 1 or 2 suits",
    suitMode: "1suit",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 2 as SuitedVal, count: 3 },
      { suit: "SA", val: 4 as SuitedVal, count: 4 },
      { suit: "SA", val: 6 as SuitedVal, count: 3 },
      { suit: "SA", val: 8 as SuitedVal, count: 4 },
    ],
    altGroups: [
      { suit: "SA", val: 2 as SuitedVal, count: 3 },
      { suit: "SA", val: 4 as SuitedVal, count: 4 },
      { suit: "SA", val: 6 as SuitedVal, count: 4 },
      { suit: "SA", val: 8 as SuitedVal, count: 3 },
    ],
  },

  // 2-suit variant — split: 2s+4s / 6s+8s
  {
    id: "2468_p_k_p_k_2s_a",
    name: "2468: 222 4444 666 8888",
    section: "2468",
    difficulty: "starter",
    value: 25,
    description: "222 4444 666 8888 or 222 4444 6666 888 — any 1 or 2 suits",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 2 as SuitedVal, count: 3 },
      { suit: "SA", val: 4 as SuitedVal, count: 4 },
      { suit: "SB", val: 6 as SuitedVal, count: 3 },
      { suit: "SB", val: 8 as SuitedVal, count: 4 },
    ],
    altGroups: [
      { suit: "SA", val: 2 as SuitedVal, count: 3 },
      { suit: "SA", val: 4 as SuitedVal, count: 4 },
      { suit: "SB", val: 6 as SuitedVal, count: 4 },
      { suit: "SB", val: 8 as SuitedVal, count: 3 },
    ],
  },

  // 2-suit variant — split: 2s+6s / 4s+8s
  {
    id: "2468_p_k_p_k_2s_b",
    name: "2468: 222 4444 666 8888",
    section: "2468",
    difficulty: "starter",
    value: 25,
    description: "222 4444 666 8888 or 222 4444 6666 888 — any 1 or 2 suits",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 2 as SuitedVal, count: 3 },
      { suit: "SB", val: 4 as SuitedVal, count: 4 },
      { suit: "SA", val: 6 as SuitedVal, count: 3 },
      { suit: "SB", val: 8 as SuitedVal, count: 4 },
    ],
    altGroups: [
      { suit: "SA", val: 2 as SuitedVal, count: 3 },
      { suit: "SB", val: 4 as SuitedVal, count: 4 },
      { suit: "SA", val: 6 as SuitedVal, count: 4 },
      { suit: "SB", val: 8 as SuitedVal, count: 3 },
    ],
  },

  // 2-suit variant — split: 2s+8s / 4s+6s
  {
    id: "2468_p_k_p_k_2s_c",
    name: "2468: 222 4444 666 8888",
    section: "2468",
    difficulty: "starter",
    value: 25,
    description: "222 4444 666 8888 or 222 4444 6666 888 — any 1 or 2 suits",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 2 as SuitedVal, count: 3 },
      { suit: "SB", val: 4 as SuitedVal, count: 4 },
      { suit: "SB", val: 6 as SuitedVal, count: 3 },
      { suit: "SA", val: 8 as SuitedVal, count: 4 },
    ],
    altGroups: [
      { suit: "SA", val: 2 as SuitedVal, count: 3 },
      { suit: "SB", val: 4 as SuitedVal, count: 4 },
      { suit: "SB", val: 6 as SuitedVal, count: 4 },
      { suit: "SA", val: 8 as SuitedVal, count: 3 },
    ],
  },

  // FF 2222 + 4444 = 6666 or FF 2222 + 6666 = 8888 (Any 3 Suits) × 25
  {
    id: "2468_ff_2_4_6",
    name: "2468: FF 2222 + 4444 = 6666",
    section: "2468",
    difficulty: "medium",
    value: 25,
    description: "FF 2222 + 4444 = 6666 or FF 2222 + 6666 = 8888 — any 3 suits",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower", val: "flower",       count: 2, jokerLocked: true },
      { suit: "SA",     val: 2 as SuitedVal, count: 4 },
      { suit: "SB",     val: 4 as SuitedVal, count: 4 },
      { suit: "SC",     val: 6 as SuitedVal, count: 4 },
    ],
    altGroups: [
      { suit: "flower", val: "flower",       count: 2, jokerLocked: true },
      { suit: "SA",     val: 2 as SuitedVal, count: 4 },
      { suit: "SB",     val: 6 as SuitedVal, count: 4 },
      { suit: "SC",     val: 8 as SuitedVal, count: 4 },
    ],
  },

  // 22 444 66 888 DDDD (Any 1 Suit) × 25
  {
    id: "2468_pr_p_pr_p_k_dragon",
    name: "2468: 22 444 66 888 DDDD",
    section: "2468",
    difficulty: "medium",
    value: 25,
    description: "22 444 66 888 DDDD — any 1 suit, any dragon",
    suitMode: "1suit",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA",     val: 2 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA",     val: 4 as SuitedVal, count: 3 },
      { suit: "SA",     val: 6 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA",     val: 8 as SuitedVal, count: 3 },
      { suit: "dragon", val: "DRAGON_ANY",    count: 4 },
    ],
  },

  // 1111 2468 222 222 (Any 3 Suits, Like Pungs Any Even No.) × 25
  // 1111=kong 1s in SA; 2,4,6,8 singles in SA; two pungs of V-even in SB & SC
  {
    id: "2468_k1_singles_pp_pp",
    name: "2468: 1111 2468 222 222",
    section: "2468",
    difficulty: "medium",
    value: 25,
    description: "1111 2468 222 222 — any 3 suits, like pungs of any even number",
    suitMode: "3suits",
    valMode: { kind: "even" },
    groups: [
      { suit: "SA", val: 1 as SuitedVal, count: 4 },
      { suit: "SA", val: 2 as SuitedVal, count: 1 },
      { suit: "SA", val: 4 as SuitedVal, count: 1 },
      { suit: "SA", val: 6 as SuitedVal, count: 1 },
      { suit: "SA", val: 8 as SuitedVal, count: 1 },
      { suit: "SB", val: { v: 0 },        count: 3 },
      { suit: "SC", val: { v: 0 },        count: 3 },
    ],
  },

  // FF 22 444 666 8888 (Any 1 Suit) × 25
  // Note: tile count 2+2+3+3+4=14
  {
    id: "2468_ff_pr_p_p_k",
    name: "2468: FF 22 444 666 8888",
    section: "2468",
    difficulty: "medium",
    value: 25,
    description: "FF 22 444 666 8888 — any 1 suit",
    suitMode: "1suit",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower", val: "flower",       count: 2, jokerLocked: true },
      { suit: "SA",     val: 2 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA",     val: 4 as SuitedVal, count: 3 },
      { suit: "SA",     val: 6 as SuitedVal, count: 3 },
      { suit: "SA",     val: 8 as SuitedVal, count: 4 },
    ],
  },

  // 222 4444 666 88 88 (Any 3 Suits, Pairs 8s Only) × 25
  {
    id: "2468_p_k_p_pr_pr",
    name: "2468: 222 4444 666 88 88",
    section: "2468",
    difficulty: "medium",
    value: 25,
    description: "222 4444 666 88 88 — any 3 suits, pairs of 8s only (joker locked)",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 2 as SuitedVal, count: 3 },
      { suit: "SB", val: 4 as SuitedVal, count: 4 },
      { suit: "SC", val: 6 as SuitedVal, count: 3 },
      { suit: "SA", val: 8 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SB", val: 8 as SuitedVal, count: 2, jokerLocked: true },
    ],
  },

  // FF 2222 DDDD 2222 (Any 3 Suits, Like Kongs Any Even No.) × 25
  {
    id: "2468_ff_k_dk_k",
    name: "2468: FF 2222 DDDD 2222",
    section: "2468",
    difficulty: "medium",
    value: 25,
    description: "FF 2222 DDDD 2222 — any 2 suits, like kongs any even number, any dragon",
    suitMode: "2suits",
    valMode: { kind: "even" },
    groups: [
      { suit: "flower", val: "flower",    count: 2, jokerLocked: true },
      { suit: "SA",     val: { v: 0 },    count: 4 },
      { suit: "dragon", val: "DRAGON_ANY", count: 4 },
      { suit: "SB",     val: { v: 0 },    count: 4 },
    ],
  },

  // 22 44 66 88 222 222 (Any 3 Suits, Like Pungs Any Even No.) × 30
  {
    id: "2468_4pr_pp_pp",
    name: "2468: 22 44 66 88 222 222",
    section: "2468",
    difficulty: "hard",
    value: 30,
    description: "22 44 66 88 222 222 — any 3 suits, like pungs of any even number",
    suitMode: "3suits",
    valMode: { kind: "even" },
    groups: [
      { suit: "SA", val: 2 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 4 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 6 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 8 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SB", val: { v: 0 },        count: 3 },
      { suit: "SC", val: { v: 0 },        count: 3 },
    ],
  },

  // ── ANY LIKE NUMBERS ───────────────────────────────────────────────────────
  // FF 1111 D 1111 D 11 (Any 3 Suits) × 25
  // Two matching dragon singles between kongs
  {
    id: "aln_ff_k_d_k_d_pr",
    name: "Any Like Numbers: FF 1111 D 1111 D 11",
    section: "any_like_numbers",
    difficulty: "medium",
    value: 25,
    description: "FF 1111 D 1111 D 11 — any 3 suits, any matching dragon",
    suitMode: "3suits",
    valMode: { kind: "any" },
    groups: [
      { suit: "flower",  val: "flower",     count: 2, jokerLocked: true },
      { suit: "SA",      val: { v: 0 },     count: 4 },
      { suit: "dragon",  val: "DRAGON_ANY", count: 1 },
      { suit: "SB",      val: { v: 0 },     count: 4 },
      { suit: "dragon",  val: "DRAGON_ANY", count: 1 },
      { suit: "SC",      val: { v: 0 },     count: 2, jokerLocked: true },
    ],
  },

  // FFFF 11 111 111 11 (Any 3 Suits, Pairs Must Be Same Suit) × 30
  // = FFFF + pair V (SA) + pung V (SB) + pung V (SC) + pair V (SA) → SA needs 4 of V
  {
    id: "aln_ffff_k_p_p",
    name: "Any Like Numbers: FFFF 11 111 111 11",
    section: "any_like_numbers",
    difficulty: "hard",
    value: 30,
    description: "FFFF 11 111 111 11 — any 3 suits, pairs must be same suit",
    suitMode: "3suits",
    valMode: { kind: "any" },
    groups: [
      { suit: "flower", val: "flower",  count: 4, jokerLocked: true },
      { suit: "SA",     val: { v: 0 },  count: 4, jokerLocked: true }, // two pairs merged
      { suit: "SB",     val: { v: 0 },  count: 3 },
      { suit: "SC",     val: { v: 0 },  count: 3 },
    ],
  },

  // FF 111 111 111 DDD (Any 3 Suits, Any Dragon) × 30
  {
    id: "aln_ff_p_p_p_dp",
    name: "Any Like Numbers: FF 111 111 111 DDD",
    section: "any_like_numbers",
    difficulty: "hard",
    value: 30,
    description: "FF 111 111 111 DDD — any 3 suits, any dragon",
    suitMode: "3suits",
    valMode: { kind: "any" },
    groups: [
      { suit: "flower", val: "flower",     count: 2, jokerLocked: true },
      { suit: "SA",     val: { v: 0 },     count: 3 },
      { suit: "SB",     val: { v: 0 },     count: 3 },
      { suit: "SC",     val: { v: 0 },     count: 3 },
      { suit: "dragon", val: "DRAGON_ANY", count: 3 },
    ],
  },

  // ── QUINTS ─────────────────────────────────────────────────────────────────
  // FF 111 2222 33333 (Any 3 Suits, Any 3 Consec.) × 40
  {
    id: "quint_ff_p_k_q",
    name: "Quints: FF 111 2222 33333",
    section: "quints",
    difficulty: "hard",
    value: 40,
    description: "FF 111 2222 33333 — any 3 suits, any 3 consecutive numbers",
    suitMode: "3suits",
    valMode: { kind: "consec", len: 3 },
    groups: [
      { suit: "flower", val: "flower",  count: 2, jokerLocked: true },
      { suit: "SA",     val: { v: 0 },  count: 3 },
      { suit: "SB",     val: { v: 1 },  count: 4 },
      { suit: "SC",     val: { v: 2 },  count: 5 },
    ],
  },

  // 11111 NNNN 22222 (Any 1 Suit, Any 2 Consec. Nos., Any Wind) × 45
  {
    id: "quint_q_wk_q",
    name: "Quints: 11111 NNNN 22222",
    section: "quints",
    difficulty: "hard",
    value: 45,
    description: "11111 NNNN 22222 — any 1 suit, any 2 consecutive numbers, any wind",
    suitMode: "1suit",
    valMode: { kind: "consec", len: 2 },
    groups: [
      { suit: "SA",   val: { v: 0 }, count: 5 },
      { suit: "wind", val: "E" as WindVal, count: 4, windVar: true },
      { suit: "SA",   val: { v: 1 }, count: 5 },
    ],
  },

  // NNNN 111 11111 11 (Any 3 Suits, Any Like Nos.) × 45
  // wind kong + pung + quint + pair of same number across 3 suits
  {
    id: "quint_wk_p_q_pr",
    name: "Quints: NNNN 111 11111 11",
    section: "quints",
    difficulty: "hard",
    value: 45,
    description: "NNNN 111 11111 11 — any 3 suits, any like numbers, any wind",
    suitMode: "3suits",
    valMode: { kind: "any" },
    groups: [
      { suit: "wind", val: "E" as WindVal, count: 4, windVar: true },
      { suit: "SA",   val: { v: 0 }, count: 3 },
      { suit: "SB",   val: { v: 0 }, count: 5 },
      { suit: "SC",   val: { v: 0 }, count: 2, jokerLocked: true },
    ],
  },

  // ── CONSECUTIVE RUN ────────────────────────────────────────────────────────
  // 11 222 3333 444 55 (Any 1 Suit, These Nos. Only) × 25
  // or 55 666 7777 888 99
  {
    id: "consec_12345",
    name: "Consecutive: 11 222 3333 444 55",
    section: "consecutive_run",
    difficulty: "starter",
    value: 25,
    description: "11 222 3333 444 55 or 55 666 7777 888 99 — any 1 suit, these numbers only",
    suitMode: "1suit",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 1 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 2 as SuitedVal, count: 3 },
      { suit: "SA", val: 3 as SuitedVal, count: 4 },
      { suit: "SA", val: 4 as SuitedVal, count: 3 },
      { suit: "SA", val: 5 as SuitedVal, count: 2, jokerLocked: true },
    ],
    altGroups: [
      { suit: "SA", val: 5 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 6 as SuitedVal, count: 3 },
      { suit: "SA", val: 7 as SuitedVal, count: 4 },
      { suit: "SA", val: 8 as SuitedVal, count: 3 },
      { suit: "SA", val: 9 as SuitedVal, count: 2, jokerLocked: true },
    ],
  },

  // 111 2222 333 4444 (Any 2 Suits, Any 4 Consec. Nos.) × 25
  // or 111 2222 3333 — interpreted as 111 2222 333 4444 vs 1111 2222 3333
  {
    id: "consec_4_2suits",
    name: "Consecutive: 111 2222 333 4444",
    section: "consecutive_run",
    difficulty: "medium",
    value: 25,
    description: "111 2222 333 4444 or 1111 2222 333 4444 — any 2 suits, any 4 consecutive",
    suitMode: "2suits",
    valMode: { kind: "consec", len: 4 },
    groups: [
      { suit: "SA", val: { v: 0 }, count: 3 },
      { suit: "SB", val: { v: 1 }, count: 4 },
      { suit: "SA", val: { v: 2 }, count: 3 },
      { suit: "SB", val: { v: 3 }, count: 4 },
    ],
    altGroups: [
      { suit: "SA", val: { v: 0 }, count: 4 },
      { suit: "SB", val: { v: 1 }, count: 4 },
      { suit: "SA", val: { v: 2 }, count: 3 },
      { suit: "SB", val: { v: 3 }, count: 3 },
    ],
  },

  // FFF 1111 22 3333 or FFFF 111 22 333 (Any 1 or 3 Suits, Any 3 Consec.) × 25
  {
    id: "consec_fff_3suits",
    name: "Consecutive: FFF 1111 22 3333",
    section: "consecutive_run",
    difficulty: "medium",
    value: 25,
    description: "FFF 1111 22 3333 or FFFF 111 22 333 — any 3 suits, any 3 consecutive",
    suitMode: "3suits",
    valMode: { kind: "consec", len: 3 },
    groups: [
      { suit: "flower", val: "flower",  count: 3, jokerLocked: true },
      { suit: "SA",     val: { v: 0 },  count: 4 },
      { suit: "SB",     val: { v: 1 },  count: 2, jokerLocked: true },
      { suit: "SC",     val: { v: 2 },  count: 5 },
    ],
    altGroups: [
      { suit: "flower", val: "flower",  count: 4, jokerLocked: true },
      { suit: "SA",     val: { v: 0 },  count: 3 },
      { suit: "SB",     val: { v: 1 },  count: 2, jokerLocked: true },
      { suit: "SC",     val: { v: 2 },  count: 5 },
    ],
  },

  // FFF 123 4444 5555 (Any 3 Suits, Any 5 Consec. Nos.) × 25
  // singles of V, V+1, V+2, then kong of V+3, kong of V+4
  {
    id: "consec_fff_singles_kk",
    name: "Consecutive: FFF 123 4444 5555",
    section: "consecutive_run",
    difficulty: "hard",
    value: 25,
    description: "FFF 123 4444 5555 — any 3 suits, any 5 consecutive numbers",
    suitMode: "3suits",
    valMode: { kind: "consec", len: 5 },
    groups: [
      { suit: "flower", val: "flower",  count: 3, jokerLocked: true },
      { suit: "SA",     val: { v: 0 },  count: 1 },
      { suit: "SB",     val: { v: 1 },  count: 1 },
      { suit: "SC",     val: { v: 2 },  count: 1 },
      { suit: "SA",     val: { v: 3 },  count: 4 },
      { suit: "SB",     val: { v: 4 },  count: 4 },
    ],
  },

  // FF 111 222 3333 DD (Any 3 Suits, Any 3 Consec. w Opp. Dragons) × 25
  {
    id: "consec_ff_p_p_k_dd",
    name: "Consecutive: FF 111 222 3333 DD",
    section: "consecutive_run",
    difficulty: "medium",
    value: 25,
    description: "FF 111 222 3333 DD — any 3 suits, any 3 consecutive, matching dragon pair",
    suitMode: "3suits",
    valMode: { kind: "consec", len: 3 },
    groups: [
      { suit: "flower",  val: "flower",     count: 2, jokerLocked: true },
      { suit: "SA",      val: { v: 0 },     count: 3 },
      { suit: "SB",      val: { v: 1 },     count: 3 },
      { suit: "SC",      val: { v: 2 },     count: 4 },
      { suit: "dragon",  val: "DRAGON_ANY", count: 2, jokerLocked: true },
    ],
  },

  // 112345 1111 1111 (Any 3 Suits, Pair + Kongs match) × 25
  // SA: pair of V + singles of V+1..V+4; SB: kong of V; SC: kong of V
  {
    id: "consec_run_singles_pk",
    name: "Consecutive: 112345 1111 1111",
    section: "consecutive_run",
    difficulty: "hard",
    value: 25,
    description: "112345 1111 1111 — any 3 suits, pair and kongs match any no. in run",
    suitMode: "3suits",
    valMode: { kind: "consec", len: 5 },
    groups: [
      { suit: "SA", val: { v: 0 }, count: 2, jokerLocked: true }, // pair of V
      { suit: "SA", val: { v: 1 }, count: 1 },                    // V+1
      { suit: "SA", val: { v: 2 }, count: 1 },                    // V+2
      { suit: "SA", val: { v: 3 }, count: 1 },                    // V+3
      { suit: "SA", val: { v: 4 }, count: 1 },                    // V+4
      { suit: "SB", val: { v: 0 }, count: 4 },                    // kong of V
      { suit: "SC", val: { v: 0 }, count: 4 },                    // kong of V
    ],
  },

  // FF 1 22 333 1 22 333 (Any 2 Suits, Any 3 Consec.) × 30
  {
    id: "consec_ff_repeat_2suits",
    name: "Consecutive: FF 1 22 333 1 22 333",
    section: "consecutive_run",
    difficulty: "hard",
    value: 30,
    description: "FF 1 22 333 1 22 333 — any 2 suits, any 3 consecutive",
    suitMode: "2suits",
    valMode: { kind: "consec", len: 3 },
    groups: [
      { suit: "flower", val: "flower",  count: 2, jokerLocked: true },
      { suit: "SA",     val: { v: 0 },  count: 2 },
      { suit: "SA",     val: { v: 1 },  count: 4, jokerLocked: true },
      { suit: "SB",     val: { v: 0 },  count: 2 },
      { suit: "SB",     val: { v: 2 },  count: 4 },
    ],
  },

  // ── 13579 ──────────────────────────────────────────────────────────────────
  // 11 333 5555 777 99 (Any 1 or 3 Suits) × 25
  {
    id: "13579_pr_p_k_p_pr",
    name: "13579: 11 333 5555 777 99",
    section: "13579",
    difficulty: "starter",
    value: 25,
    description: "11 333 5555 777 99 — any 1 or 3 suits",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 1 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SB", val: 3 as SuitedVal, count: 3 },
      { suit: "SA", val: 5 as SuitedVal, count: 4 },
      { suit: "SB", val: 7 as SuitedVal, count: 3 },
      { suit: "SA", val: 9 as SuitedVal, count: 2, jokerLocked: true },
    ],
    altGroups: [
      { suit: "SA", val: 1 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 3 as SuitedVal, count: 3 },
      { suit: "SA", val: 5 as SuitedVal, count: 4 },
      { suit: "SA", val: 7 as SuitedVal, count: 3 },
      { suit: "SA", val: 9 as SuitedVal, count: 2, jokerLocked: true },
    ],
  },

  // 111 333 3333 5555 or 555 7777 777 9999 (Any 2 Suits) × 25
  {
    id: "13579_p_p_k_k",
    name: "13579: 111 333 3333 5555",
    section: "13579",
    difficulty: "medium",
    value: 25,
    description: "111 333 3333 5555 or 555 7777 777 9999 — any 2 suits",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 1 as SuitedVal, count: 3 },
      { suit: "SB", val: 3 as SuitedVal, count: 3 },
      { suit: "SA", val: 3 as SuitedVal, count: 4 },
      { suit: "SB", val: 5 as SuitedVal, count: 4 },
    ],
    altGroups: [
      { suit: "SA", val: 5 as SuitedVal, count: 3 },
      { suit: "SB", val: 7 as SuitedVal, count: 4 },
      { suit: "SA", val: 7 as SuitedVal, count: 3 },
      { suit: "SB", val: 9 as SuitedVal, count: 4 },
    ],
  },

  // 1111 333 5555 DDD or 555 7777 9999 DDD (Any 1 Suit) × 25
  {
    id: "13579_k_p_k_dp",
    name: "13579: 1111 333 5555 DDD",
    section: "13579",
    difficulty: "medium",
    value: 25,
    description: "1111 333 5555 DDD or 555 7777 9999 DDD — any 1 suit, any dragon",
    suitMode: "1suit",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA",     val: 1 as SuitedVal, count: 4 },
      { suit: "SA",     val: 3 as SuitedVal, count: 3 },
      { suit: "SA",     val: 5 as SuitedVal, count: 4 },
      { suit: "dragon", val: "DRAGON_ANY",    count: 3 },
    ],
    altGroups: [
      { suit: "SA",     val: 5 as SuitedVal, count: 3 },
      { suit: "SA",     val: 7 as SuitedVal, count: 4 },
      { suit: "SA",     val: 9 as SuitedVal, count: 4 },
      { suit: "dragon", val: "DRAGON_ANY",    count: 3 },
    ],
  },

  // FFF 135 7777 9999 or FF 135 7777 9999 (Any 1 or 3 Suits) × 25
  {
    id: "13579_fff_singles_kk",
    name: "13579: FFF 135 7777 9999",
    section: "13579",
    difficulty: "medium",
    value: 25,
    description: "FFF 135 7777 9999 or FF 135 7777 9999 — any 1 or 3 suits",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower", val: "flower",       count: 3, jokerLocked: true },
      { suit: "SA",     val: 1 as SuitedVal, count: 1 },
      { suit: "SB",     val: 3 as SuitedVal, count: 1 },
      { suit: "SC",     val: 5 as SuitedVal, count: 1 },
      { suit: "SA",     val: 7 as SuitedVal, count: 4 },
      { suit: "SA",     val: 9 as SuitedVal, count: 4 },
    ],
    altGroups: [
      { suit: "flower", val: "flower",       count: 2, jokerLocked: true },
      { suit: "SA",     val: 1 as SuitedVal, count: 1 },
      { suit: "SB",     val: 3 as SuitedVal, count: 1 },
      { suit: "SC",     val: 5 as SuitedVal, count: 1 },
      { suit: "SA",     val: 7 as SuitedVal, count: 4 },
      { suit: "SA",     val: 9 as SuitedVal, count: 5 },
    ],
  },

  // 333 NEWS 333 99 — needs NEWS expansion (one each N/E/W/S wind)
  // Actually this is "333 N E W S 333 99" in opp suit × 25
  // Total: 3+1+1+1+1+3+2+? — need 2 more. Let me encode as-read.
  // From card: "333 NEWS 333 99 (Any 3 Suits in Opp. Dragons)" × 25
  // Likely: 333(3) + N(1)+E(1)+W(1)+S(1) + 333(3) + 99(2) + D(2)?
  // = 3+4+3+2+2=14 ✓ if DD is added: "333 NEWS 333 99 DD"
  // Best interpretation: 3+4+3+2+2=14 with dragon pair
  {
    id: "13579_news_333",
    name: "13579: 333 NEWS 333 99",
    section: "13579",
    difficulty: "hard",
    value: 25,
    description: "333 NEWS 333 99 — any 3 suits, NEWS winds, matching dragon pair",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA",     val: 3 as SuitedVal,       count: 3 },
      { suit: "wind",   val: "N" as WindVal,        count: 1 },
      { suit: "wind",   val: "E" as WindVal,        count: 1 },
      { suit: "wind",   val: "W" as WindVal,        count: 1 },
      { suit: "wind",   val: "S" as WindVal,        count: 1 },
      { suit: "SB",     val: 3 as SuitedVal,        count: 3 },
      { suit: "SA",     val: 9 as SuitedVal,        count: 2, jokerLocked: true },
      { suit: "dragon", val: "DRAGON_ANY",           count: 2, jokerLocked: true },
    ],
  },

  // 1111 33 NEWS 77 99 (Any 2 Suits) × 30
  {
    id: "13579_k_pr_news_pr_pr",
    name: "13579: 1111 33 NEWS 77 99",
    section: "13579",
    difficulty: "hard",
    value: 30,
    description: "1111 33 NEWS 77 99 — any 2 suits",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA",   val: 1 as SuitedVal, count: 4 },
      { suit: "SA",   val: 3 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "wind", val: "N" as WindVal, count: 1 },
      { suit: "wind", val: "E" as WindVal, count: 1 },
      { suit: "wind", val: "W" as WindVal, count: 1 },
      { suit: "wind", val: "S" as WindVal, count: 1 },
      { suit: "SB",   val: 7 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SB",   val: 9 as SuitedVal, count: 2, jokerLocked: true },
    ],
  },

  // 1111 33 55 77 9999 (Any 2 Suits) × 30
  {
    id: "13579_k_pr_pr_pr_k",
    name: "13579: 1111 33 55 77 9999",
    section: "13579",
    difficulty: "hard",
    value: 30,
    description: "1111 33 55 77 9999 — any 2 suits",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 1 as SuitedVal, count: 4 },
      { suit: "SB", val: 3 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SB", val: 5 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SB", val: 7 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 9 as SuitedVal, count: 4 },
    ],
  },

  // 55 77 555 777 99 (Any 3 Suits) × 30
  {
    id: "13579_pr_pr_p_p_pr",
    name: "13579: 55 77 555 777 99",
    section: "13579",
    difficulty: "hard",
    value: 30,
    description: "55 77 555 777 99 — any 3 suits",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 5 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SB", val: 7 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 5 as SuitedVal, count: 3 },
      { suit: "SB", val: 7 as SuitedVal, count: 3 },
      { suit: "SC", val: 9 as SuitedVal, count: 4 },
    ],
  },

  // ── WINDS & DRAGONS ────────────────────────────────────────────────────────
  // NNNN EEE WWW SSSS or NNN EEEE WWW SSS × 25
  {
    id: "wd_k_p_p_k",
    name: "Winds & Dragons: NNNN EEE WWW SSSS",
    section: "winds_dragons",
    difficulty: "medium",
    value: 25,
    description: "NNNN EEE WWW SSSS or NNN EEEE WWW SSS — all four winds",
    suitMode: "none",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "wind", val: "N" as WindVal, count: 4 },
      { suit: "wind", val: "E" as WindVal, count: 3 },
      { suit: "wind", val: "W" as WindVal, count: 3 },
      { suit: "wind", val: "S" as WindVal, count: 4 },
    ],
    altGroups: [
      { suit: "wind", val: "N" as WindVal, count: 3 },
      { suit: "wind", val: "E" as WindVal, count: 4 },
      { suit: "wind", val: "W" as WindVal, count: 3 },
      { suit: "wind", val: "S" as WindVal, count: 4 },
    ],
  },

  // FF 123 DD DDD DDDD (Any 3 Consec. in 1 Suit, Any 3 Dragons) × 25
  {
    id: "wd_ff_singles_d_dp_dk",
    name: "Winds & Dragons: FF 123 DD DDD DDDD",
    section: "winds_dragons",
    difficulty: "hard",
    value: 25,
    description: "FF 123 DD DDD DDDD — any 3 consecutive in 1 suit, all 3 dragon types",
    suitMode: "1suit",
    valMode: { kind: "consec", len: 3 },
    groups: [
      { suit: "flower",  val: "flower",              count: 2, jokerLocked: true },
      { suit: "SA",      val: { v: 0 },              count: 1 },
      { suit: "SA",      val: { v: 1 },              count: 1 },
      { suit: "SA",      val: { v: 2 },              count: 1 },
      { suit: "dragon",  val: "red"   as DragonVal,  count: 2, jokerLocked: true },
      { suit: "dragon",  val: "green" as DragonVal,  count: 3 },
      { suit: "dragon",  val: "white" as DragonVal,  count: 4 },
    ],
  },

  // FFF NN EEE DD DDDD or FFF DDD NEWS DDD (Dragons Any 2 Suits) × 25
  {
    id: "wd_fff_winds_dragons",
    name: "Winds & Dragons: FFF NN EEE DD DDDD",
    section: "winds_dragons",
    difficulty: "hard",
    value: 25,
    description: "FFF NN EEE DD DDDD or FFF DDD NEWS DDD — winds + dragons",
    suitMode: "none",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower", val: "flower",              count: 3, jokerLocked: true },
      { suit: "wind",   val: "N"     as WindVal,    count: 2, jokerLocked: true },
      { suit: "wind",   val: "E"     as WindVal,    count: 3 },
      { suit: "dragon", val: "DRAGON_ANY",           count: 2, jokerLocked: true },
      { suit: "dragon", val: "DRAGON_ANY",           count: 4 },
    ],
    altGroups: [
      { suit: "flower", val: "flower",           count: 3, jokerLocked: true },
      { suit: "dragon", val: "DRAGON_ANY",        count: 3 },
      { suit: "wind",   val: "N" as WindVal,      count: 1 },
      { suit: "wind",   val: "E" as WindVal,      count: 1 },
      { suit: "wind",   val: "W" as WindVal,      count: 1 },
      { suit: "wind",   val: "S" as WindVal,      count: 1 },
      { suit: "dragon", val: "DRAGON_ANY",        count: 4 },
    ],
  },

  // FFFF DDD NEWS DDDD × 25
  {
    id: "wd_ffff_dp_news_dk",
    name: "Winds & Dragons: FFFF DDD NEWS DDDD",
    section: "winds_dragons",
    difficulty: "hard",
    value: 25,
    description: "FFFF DDD NEWS DDDD — four flowers, dragon pung, all four winds, dragon kong",
    suitMode: "none",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower", val: "flower",        count: 4, jokerLocked: true },
      { suit: "dragon", val: "DRAGON_ANY",     count: 3 },
      { suit: "wind",   val: "N" as WindVal,   count: 1 },
      { suit: "wind",   val: "E" as WindVal,   count: 1 },
      { suit: "wind",   val: "W" as WindVal,   count: 1 },
      { suit: "wind",   val: "S" as WindVal,   count: 1 },
      { suit: "dragon", val: "DRAGON_ANY",     count: 3 },
    ],
  },

  // EEEE 2 22 222 WWWW (Any Like Even Nos. in 3 Suits) × 25
  {
    id: "wd_eeee_like_even_wwww",
    name: "Winds & Dragons: EEEE 2 22 222 WWWW",
    section: "winds_dragons",
    difficulty: "hard",
    value: 25,
    description: "EEEE 2 22 222 WWWW — east kong, like even numbers in 3 suits, west kong",
    suitMode: "3suits",
    valMode: { kind: "even" },
    groups: [
      { suit: "wind", val: "E" as WindVal, count: 4 },
      { suit: "SA",   val: { v: 0 },       count: 1 },
      { suit: "SB",   val: { v: 0 },       count: 2, jokerLocked: true },
      { suit: "SC",   val: { v: 0 },       count: 3 },
      { suit: "wind", val: "W" as WindVal, count: 4 },
    ],
  },

  // NN EEE WWW SS 2025 or NN EEE WWW 2025 (Any 3 Suit w Lucky Dragon) × 30
  {
    id: "wd_news_2025",
    name: "Winds & Dragons: NN EEE WWW SS 2025",
    section: "winds_dragons",
    difficulty: "hard",
    value: 30,
    description: "NN EEE WWW SS 2025 — winds + year tiles + lucky dragon",
    suitMode: "1suit",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "wind",   val: "N" as WindVal,        count: 2, jokerLocked: true },
      { suit: "wind",   val: "E" as WindVal,        count: 3 },
      { suit: "wind",   val: "W" as WindVal,        count: 3 },
      { suit: "wind",   val: "S" as WindVal,        count: 2, jokerLocked: true },
      { suit: "SA",     val: 2 as SuitedVal,        count: 1 },
      { suit: "dragon", val: "white" as DragonVal,  count: 1 },
      { suit: "SA",     val: 2 as SuitedVal,        count: 1 },
      { suit: "SA",     val: 5 as SuitedVal,        count: 1 },
    ],
  },

  // NN EE WWW SSS DDDD (Any Odd Nos., Any Dragon) × 30
  {
    id: "wd_news_odd_dk",
    name: "Winds & Dragons: NN EE WWW SSS DDDD",
    section: "winds_dragons",
    difficulty: "hard",
    value: 30,
    description: "NN EE WWW SSS DDDD — any odd suited tiles + any dragon kong",
    suitMode: "none",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "wind",   val: "N" as WindVal,  count: 2, jokerLocked: true },
      { suit: "wind",   val: "E" as WindVal,  count: 2, jokerLocked: true },
      { suit: "wind",   val: "W" as WindVal,  count: 3 },
      { suit: "wind",   val: "S" as WindVal,  count: 3 },
      { suit: "dragon", val: "DRAGON_ANY",     count: 4 },
    ],
  },

  // ── 369 ────────────────────────────────────────────────────────────────────
  // 333 6666 666 9999 or 333 6666 6666 9999 (Any 2 or 3 Suits) × 25
  {
    id: "369_p_k_p_k",
    name: "369: 333 6666 666 9999",
    section: "369",
    difficulty: "starter",
    value: 25,
    description: "333 6666 666 9999 or 333 6666 6666 9999 — any 2 or 3 suits",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 3 as SuitedVal, count: 3 },
      { suit: "SB", val: 6 as SuitedVal, count: 4 },
      { suit: "SC", val: 6 as SuitedVal, count: 3 },
      { suit: "SA", val: 9 as SuitedVal, count: 4 },
    ],
    altGroups: [
      { suit: "SA", val: 3 as SuitedVal, count: 3 },
      { suit: "SB", val: 6 as SuitedVal, count: 4 },
      { suit: "SC", val: 6 as SuitedVal, count: 4 },
      { suit: "SA", val: 9 as SuitedVal, count: 3 },
    ],
  },

  // FF 3333 6666 + 3333 or FF 3333 + 6666 = 9999 (Any 1 or 3 Suits) × 25
  {
    id: "369_ff_math",
    name: "369: FF 3333 + 6666 = 9999",
    section: "369",
    difficulty: "medium",
    value: 25,
    description: "FF 3333 6666 + 3333 or FF 3333 + 6666 = 9999 — any 1 or 3 suits",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower", val: "flower",       count: 2, jokerLocked: true },
      { suit: "SA",     val: 3 as SuitedVal, count: 4 },
      { suit: "SB",     val: 6 as SuitedVal, count: 4 },
      { suit: "SC",     val: 3 as SuitedVal, count: 4 },
    ],
    altGroups: [
      { suit: "flower", val: "flower",       count: 2, jokerLocked: true },
      { suit: "SA",     val: 3 as SuitedVal, count: 4 },
      { suit: "SB",     val: 6 as SuitedVal, count: 4 },
      { suit: "SC",     val: 9 as SuitedVal, count: 4 },
    ],
  },

  // 3333 DDD 3333 DDD (Any 2 Suits, Matching Dragons) × 25
  {
    id: "369_k_dp_k_dp",
    name: "369: 3333 DDD 3333 DDD",
    section: "369",
    difficulty: "medium",
    value: 25,
    description: "3333 DDD 3333 DDD — any 2 suits, any matching dragons",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA",     val: 3 as SuitedVal, count: 4 },
      { suit: "dragon", val: "DRAGON_ANY",    count: 3 },
      { suit: "SB",     val: 3 as SuitedVal, count: 4 },
      { suit: "dragon", val: "DRAGON_ANY",    count: 3 },
    ],
  },

  // FFF 333 369 99999 (Any 2 Suits) × 25
  // FFF(3) + 333(3) + 3(1)+6(1)+9(1) + 99999(5) = 3+3+3+5=14 ✓
  // SA has pung of 3s + the "3" and "9" singles; SB has the "6" single + quint of 9s
  {
    id: "369_fff_p_singles_quint",
    name: "369: FFF 333 369 99999",
    section: "369",
    difficulty: "medium",
    value: 25,
    description: "FFF 333 369 99999 — any 2 suits",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower", val: "flower",       count: 3, jokerLocked: true },
      { suit: "SA",     val: 3 as SuitedVal, count: 3 },  // 333 pung
      { suit: "SA",     val: 3 as SuitedVal, count: 1 },  // single 3 from "369" → 4 total SA-3
      { suit: "SA",     val: 6 as SuitedVal, count: 1 },  // single 6 from "369"
      { suit: "SA",     val: 9 as SuitedVal, count: 1 },  // single 9 from "369"
      { suit: "SB",     val: 9 as SuitedVal, count: 5 },  // 99999 quint in 2nd suit
    ],
  },

  // FFF 33 69 333 6666 (Any 3 Suits, Kongs 3, 6, or 9) × 25
  // FFF(3) + 33(2) + 6(1) + 9(1) + 333(3) + 6666(4) = 3+2+1+1+3+4=14 ✓
  // SA: pair of 3s; SB: single 6 + pung of 3s; SC: single 9 + kong of 6s
  {
    id: "369_fff_33_69_333_6666",
    name: "369: FFF 33 69 333 6666",
    section: "369",
    difficulty: "hard",
    value: 25,
    description: "FFF 33 69 333 6666 — any 3 suits, kongs 3, 6, or 9",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower", val: "flower",       count: 3, jokerLocked: true },
      { suit: "SA",     val: 3 as SuitedVal, count: 2, jokerLocked: true },  // 33 pair
      { suit: "SB",     val: 6 as SuitedVal, count: 1 },                      // single 6
      { suit: "SC",     val: 9 as SuitedVal, count: 1 },                      // single 9
      { suit: "SB",     val: 3 as SuitedVal, count: 3 },                      // 333 pung
      { suit: "SC",     val: 6 as SuitedVal, count: 4 },                      // 6666 kong
    ],
  },

  // FF 333 D 666 D 999 D (Any 3 Suits, Kongs w Matching Dragons) × 30
  {
    id: "369_ff_p_d_p_d_p_d",
    name: "369: FF 333 D 666 D 999 D",
    section: "369",
    difficulty: "hard",
    value: 30,
    description: "FF 333 D 666 D 999 D — any 3 suits, each pung with matching dragon",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower",  val: "flower",              count: 2, jokerLocked: true },
      { suit: "SA",      val: 3 as SuitedVal,        count: 3 },
      { suit: "dragon",  val: "red"   as DragonVal,  count: 1 },
      { suit: "SB",      val: 6 as SuitedVal,        count: 3 },
      { suit: "dragon",  val: "green" as DragonVal,  count: 1 },
      { suit: "SC",      val: 9 as SuitedVal,        count: 3 },
      { suit: "dragon",  val: "white" as DragonVal,  count: 1 },
    ],
  },

  // ── SINGLES AND PAIRS (closed hands — no exposed melds) ───────────────────
  // NN EW SS 11 22 33 44 (Any 1 Suit, Any 4 Consec. Nos.) × 50
  {
    id: "sp_news_4consec",
    name: "Singles & Pairs: NN EW SS 11 22 33 44",
    section: "singles_pairs",
    difficulty: "hard",
    value: 50,
    closed: true,
    description: "NN EW SS 11 22 33 44 — any 1 suit, any 4 consecutive numbers",
    suitMode: "1suit",
    valMode: { kind: "consec", len: 4 },
    groups: [
      { suit: "wind", val: "N" as WindVal, count: 2, jokerLocked: true },
      { suit: "wind", val: "E" as WindVal, count: 1, jokerLocked: true },
      { suit: "wind", val: "W" as WindVal, count: 1, jokerLocked: true },
      { suit: "wind", val: "S" as WindVal, count: 2, jokerLocked: true },
      { suit: "SA",   val: { v: 0 },       count: 2, jokerLocked: true },
      { suit: "SA",   val: { v: 1 },       count: 2, jokerLocked: true },
      { suit: "SA",   val: { v: 2 },       count: 2, jokerLocked: true },
      { suit: "SA",   val: { v: 3 },       count: 2, jokerLocked: true },
    ],
  },

  // FF 2468 DD 2468 DD (Any 2 Suits w Matching Dragons) × 50
  {
    id: "sp_ff_2468_dd_2468_dd",
    name: "Singles & Pairs: FF 2468 DD 2468 DD",
    section: "singles_pairs",
    difficulty: "hard",
    value: 50,
    closed: true,
    description: "FF 2468 DD 2468 DD — any 2 suits, matching dragon pairs",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower",  val: "flower",              count: 2, jokerLocked: true },
      { suit: "SA",      val: 2 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SA",      val: 4 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SA",      val: 6 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SA",      val: 8 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "dragon",  val: "DRAGON_ANY",           count: 2, jokerLocked: true },
      { suit: "SB",      val: 2 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SB",      val: 4 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SB",      val: 6 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SB",      val: 8 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "dragon",  val: "DRAGON_ANY",           count: 2, jokerLocked: true },
    ],
  },

  // 33 66 99 33 66 99 (Any 3 Suits in Opposite Diagonal) × 50
  {
    id: "sp_369_diagonal",
    name: "Singles & Pairs: 33 66 99 33 66 99",
    section: "singles_pairs",
    difficulty: "hard",
    value: 50,
    closed: true,
    description: "33 66 99 33 66 99 — any 3 suits in opposite diagonal pattern",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 3 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SB", val: 6 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SC", val: 9 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SB", val: 3 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SC", val: 6 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 9 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SC", val: 3 as SuitedVal, count: 2, jokerLocked: true },
    ],
  },

  // FF 11 22 11 22 11 22 (Any 3 Suits, Any 2 Consec. Nos.) × 50
  {
    id: "sp_ff_2consec_3suits",
    name: "Singles & Pairs: FF 11 22 11 22 11 22",
    section: "singles_pairs",
    difficulty: "hard",
    value: 50,
    closed: true,
    description: "FF 11 22 11 22 11 22 — any 3 suits, any 2 consecutive numbers",
    suitMode: "3suits",
    valMode: { kind: "consec", len: 2 },
    groups: [
      { suit: "flower", val: "flower",  count: 2, jokerLocked: true },
      { suit: "SA",     val: { v: 0 },  count: 2, jokerLocked: true },
      { suit: "SA",     val: { v: 1 },  count: 2, jokerLocked: true },
      { suit: "SB",     val: { v: 0 },  count: 2, jokerLocked: true },
      { suit: "SB",     val: { v: 1 },  count: 2, jokerLocked: true },
      { suit: "SC",     val: { v: 0 },  count: 2, jokerLocked: true },
      { suit: "SC",     val: { v: 1 },  count: 2, jokerLocked: true },
    ],
  },

  // 11 33 55 77 99 9999 (Any 2 Suits) × 50
  {
    id: "sp_odds_pairs_kong",
    name: "Singles & Pairs: 11 33 55 77 99 9999",
    section: "singles_pairs",
    difficulty: "hard",
    value: 50,
    closed: true,
    description: "11 33 55 77 99 9999 — any 2 suits, pairs of odds in one suit + kong of 9s in other",
    suitMode: "2suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "SA", val: 1 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 3 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 5 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 7 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SA", val: 9 as SuitedVal, count: 2, jokerLocked: true },
      { suit: "SB", val: 9 as SuitedVal, count: 4, jokerLocked: true },
    ],
  },

  // FF 2025 2025 2025 (Any 3 Suits) × 75
  {
    id: "sp_ff_2025_x3",
    name: "Singles & Pairs: FF 2025 2025 2025",
    section: "singles_pairs",
    difficulty: "hard",
    value: 75,
    closed: true,
    description: "FF 2025 2025 2025 — any 3 suits (highest value hand!)",
    suitMode: "3suits",
    valMode: { kind: "fixed" },
    groups: [
      { suit: "flower",  val: "flower",              count: 2, jokerLocked: true },
      { suit: "SA",      val: 2 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "dragon",  val: "white" as DragonVal,  count: 1, jokerLocked: true },
      { suit: "SA",      val: 2 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SA",      val: 5 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SB",      val: 2 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "dragon",  val: "white" as DragonVal,  count: 1, jokerLocked: true },
      { suit: "SB",      val: 2 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SB",      val: 5 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SC",      val: 2 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "dragon",  val: "white" as DragonVal,  count: 1, jokerLocked: true },
      { suit: "SC",      val: 2 as SuitedVal,        count: 1, jokerLocked: true },
      { suit: "SC",      val: 5 as SuitedVal,        count: 1, jokerLocked: true },
    ],
  },
];

// Pre-computed flat array of all concrete instantiations (cached at module load)
export const CONCRETE_PATTERNS: HandPattern[] = PATTERNS.flatMap(instantiateTemplate);

// Validate at module load time
for (const t of PATTERNS) {
  // Check main groups sum
  const checkGroups = (gs: TemplateGroup[], label: string) => {
    // We can only validate fixed-suit, fixed-val groups directly
    const hasSuitVar = gs.some(g => g.suit === "SA" || g.suit === "SB" || g.suit === "SC");
    const hasValVar  = gs.some(g => typeof g.val === "object" && "v" in (g.val as object));
    if (hasSuitVar || hasValVar) return; // skip variable groups
    const sum = gs.reduce((a, g) => a + g.count, 0);
    if (sum !== 14) throw new Error(`Pattern "${t.id}" ${label} has ${sum} tiles, expected 14`);
  };
  checkGroups(t.groups, "groups");
  if (t.altGroups) checkGroups(t.altGroups, "altGroups");
}
