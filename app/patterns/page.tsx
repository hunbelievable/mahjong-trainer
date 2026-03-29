"use client";

import { useMemo, useState } from "react";
import { PATTERNS } from "@/engine/patterns";
import type { HandPatternTemplate, TemplateGroup, SuitSpec } from "@/engine/patterns";

// ── Section metadata ────────────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  "2025":             "2025",
  "2468":             "2468",
  "any_like_numbers": "Any Like Numbers",
  "quints":           "Quints",
  "consecutive_run":  "Consecutive Run",
  "13579":            "13579",
  "winds_dragons":    "Winds & Dragons",
  "369":              "3-6-9",
  "singles_pairs":    "Singles & Pairs",
};

const SECTION_ORDER = [
  "2025", "2468", "any_like_numbers", "quints",
  "consecutive_run", "13579", "winds_dragons", "369", "singles_pairs",
];

const SECTION_COLORS: Record<string, string> = {
  "2025":             "bg-violet-600",
  "2468":             "bg-blue-600",
  "any_like_numbers": "bg-cyan-600",
  "quints":           "bg-orange-500",
  "consecutive_run":  "bg-teal-600",
  "13579":            "bg-red-600",
  "winds_dragons":    "bg-amber-500",
  "369":              "bg-green-600",
  "singles_pairs":    "bg-pink-600",
};

const SECTION_BG: Record<string, string> = {
  "2025":             "bg-violet-50 border-violet-200",
  "2468":             "bg-blue-50 border-blue-200",
  "any_like_numbers": "bg-cyan-50 border-cyan-200",
  "quints":           "bg-orange-50 border-orange-200",
  "consecutive_run":  "bg-teal-50 border-teal-200",
  "13579":            "bg-red-50 border-red-200",
  "winds_dragons":    "bg-amber-50 border-amber-200",
  "369":              "bg-green-50 border-green-200",
  "singles_pairs":    "bg-pink-50 border-pink-200",
};

// ── Tile chip rendering ──────────────────────────────────────────────────────

const SUIT_CHIP: Record<string, string> = {
  dots:   "bg-blue-500 text-white",
  bams:   "bg-green-600 text-white",
  cracks: "bg-red-600 text-white",
  wind:   "bg-amber-400 text-amber-900",
  dragon: "bg-purple-600 text-white",
  flower: "bg-pink-500 text-white",
  joker:  "bg-gray-700 text-white",
  SA:     "bg-blue-400 text-white",
  SB:     "bg-green-500 text-white",
  SC:     "bg-red-500 text-white",
};

function suitShort(suit: SuitSpec): string {
  const map: Record<string, string> = {
    dots: "D", bams: "B", cracks: "C",
    wind: "W", dragon: "Dr", flower: "F", joker: "Jkr",
    SA: "·", SB: "B", SC: "C",
  };
  return map[suit as string] ?? String(suit);
}

function valShort(g: TemplateGroup): string {
  if (g.windVar) return "W";
  const v = g.val;
  if (v === "ZERO") return "0";
  if (v === "DRAGON_ANY") return "D";
  if (typeof v === "object" && "v" in v) return v.v === 0 ? "N" : `N+${v.v}`;
  if (typeof v === "number") return String(v);
  const map: Record<string, string> = {
    E: "E", S: "S", W: "W", N: "N",
    red: "R", green: "G", white: "0",
    flower: "★", joker: "J",
  };
  return map[v as string] ?? String(v);
}

function TileGroup({ group, jokerLocked }: { group: TemplateGroup; jokerLocked?: boolean }) {
  const chipColor = SUIT_CHIP[group.suit as string] ?? "bg-gray-500 text-white";
  const label = `${suitShort(group.suit)}${valShort(group)}`;
  return (
    <span className="inline-flex gap-0.5 items-center">
      {Array.from({ length: group.count }).map((_, i) => (
        <span
          key={i}
          className={`
            inline-flex items-center justify-center
            w-7 h-8 rounded text-[10px] font-bold leading-none
            ${chipColor}
            ${jokerLocked ? "ring-1 ring-offset-0 ring-white/60" : ""}
          `}
          title={jokerLocked ? "No jokers" : undefined}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

// ── Pattern card ─────────────────────────────────────────────────────────────

const DIFF_PILL: Record<string, string> = {
  starter: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  medium:  "bg-amber-100 text-amber-700 border border-amber-200",
  hard:    "bg-red-100 text-red-700 border border-red-200",
};

function PatternCard({ pattern, accentColor }: { pattern: HandPatternTemplate; accentColor: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Color accent bar */}
      <div className={`h-1 ${accentColor}`} />

      <div className="p-4 space-y-3">
        {/* Header row: name + value */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5 min-w-0">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide leading-none">
              {pattern.name}
            </div>
            {/* NMJL card notation — the main feature */}
            <div className="text-sm font-bold text-gray-900 leading-snug">
              {/* Split on " — " to show notation + note separately */}
              {pattern.description.split(" — ").map((part, i) => (
                i === 0
                  ? <span key={i} className="font-mono tracking-wide">{part}</span>
                  : <span key={i} className="block text-xs font-normal text-gray-500 mt-0.5 font-sans">{part}</span>
              ))}
            </div>
          </div>
          <div className="shrink-0 text-right space-y-1">
            <div className="text-base font-extrabold text-indigo-600 tabular-nums">{pattern.value}pts</div>
            <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded font-semibold ${DIFF_PILL[pattern.difficulty]}`}>
              {pattern.difficulty}
            </span>
          </div>
        </div>

        {/* Tile chips */}
        <div className="flex flex-wrap gap-2 items-start">
          <div className="flex flex-wrap gap-1.5 items-center">
            {pattern.groups.map((g, i) => (
              <TileGroup key={i} group={g} jokerLocked={g.jokerLocked} />
            ))}
          </div>

          {pattern.altGroups && (
            <>
              <span className="self-center text-xs font-bold text-gray-400">or</span>
              <div className="flex flex-wrap gap-1.5 items-center">
                {pattern.altGroups.map((g, i) => (
                  <TileGroup key={i} group={g} jokerLocked={g.jokerLocked} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Mode tags */}
        <div className="flex gap-1.5 flex-wrap pt-0.5">
          {pattern.suitMode !== "none" && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-50 text-indigo-600 font-semibold border border-indigo-100">
              {pattern.suitMode === "1suit" ? "1 suit" : pattern.suitMode === "2suits" ? "2 suits" : "3 suits"}
            </span>
          )}
          {pattern.valMode.kind !== "fixed" && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-violet-50 text-violet-600 font-semibold border border-violet-100">
              {pattern.valMode.kind === "any" ? "any N"
                : pattern.valMode.kind === "even" ? "N even"
                : pattern.valMode.kind === "odd" ? "N odd"
                : pattern.valMode.kind === "consec" ? `N consec ×${pattern.valMode.len}`
                : ""}
            </span>
          )}
          {pattern.closed && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-rose-50 text-rose-600 font-semibold border border-rose-100">
              closed hand
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <details className="bg-white rounded-xl border border-gray-200 p-4">
      <summary className="cursor-pointer text-xs font-semibold text-gray-600 hover:text-gray-800 select-none">
        How to read this card ▸
      </summary>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-600 leading-relaxed">
        <div>
          <strong>Tile chips</strong> — each chip shows suit + value.
          Suits: <span className="font-mono px-1 rounded bg-blue-500 text-white">·N</span> Dots,{" "}
          <span className="font-mono px-1 rounded bg-green-600 text-white">BN</span> Bams,{" "}
          <span className="font-mono px-1 rounded bg-red-600 text-white">CN</span> Cracks,{" "}
          <span className="font-mono px-1 rounded bg-amber-400 text-amber-900">W</span> Wind,{" "}
          <span className="font-mono px-1 rounded bg-purple-600 text-white">Dr</span> Dragon,{" "}
          <span className="font-mono px-1 rounded bg-pink-500 text-white">F</span> Flower
        </div>
        <div>
          <strong>Suit variables</strong> — SA, SB, SC are distinct suited suits (dots / bams / cracks) that must each be a different suit within the hand.
        </div>
        <div>
          <strong>Value variables</strong> — <code>N</code> = any valid tile value; <code>N+1</code> = one higher.{" "}
          <code>0</code> = white dragon; <code>D</code> = any dragon.
        </div>
        <div>
          <strong>Ring border on chip</strong> — that group cannot use joker tiles.
          <br /><strong>closed hand</strong> — no exposed melds allowed.
        </div>
      </div>
    </details>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PatternsPage() {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [activeDiff, setActiveDiff] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleSection = (section: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(section) ? next.delete(section) : next.add(section);
      return next;
    });
  };

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result: Record<string, HandPatternTemplate[]> = {};
    for (const section of SECTION_ORDER) {
      result[section] = PATTERNS.filter(p => {
        if (p.section !== section) return false;
        if (activeSection && p.section !== activeSection) return false;
        if (activeDiff && p.difficulty !== activeDiff) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.section.toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [search, activeSection, activeDiff]);

  const totalShown = Object.values(grouped).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900">Mahjong Trainer</h1>
          <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-700 font-semibold">
            Pattern Reference
          </span>
        </div>
        <span className="text-xs text-gray-400">{PATTERNS.length} patterns · NMJL 2025 card</span>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search patterns by name or notation…"
          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
        />

        {/* Section filter */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setActiveSection(null)}
            className={`px-3 py-1 text-xs rounded-full font-semibold transition-colors ${
              activeSection === null ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All sections
          </button>
          {SECTION_ORDER.map(s => (
            <button
              key={s}
              onClick={() => setActiveSection(activeSection === s ? null : s)}
              className={`px-3 py-1 text-xs rounded-full font-semibold transition-colors ${
                activeSection === s
                  ? `${SECTION_COLORS[s]} text-white`
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {SECTION_LABELS[s] ?? s}
            </button>
          ))}
        </div>

        {/* Difficulty filter */}
        <div className="flex gap-1.5 items-center">
          <span className="text-xs text-gray-500 font-medium">Difficulty:</span>
          {["starter", "medium", "hard"].map(d => (
            <button
              key={d}
              onClick={() => setActiveDiff(activeDiff === d ? null : d)}
              className={`px-2.5 py-0.5 text-xs rounded-full font-semibold border transition-colors ${
                activeDiff === d ? DIFF_PILL[d] + " opacity-100" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        <Legend />

        {totalShown === 0 && (
          <div className="text-sm text-gray-400 italic py-8 text-center">No patterns match your search.</div>
        )}

        {/* Sections */}
        {SECTION_ORDER.map(section => {
          const patterns = grouped[section];
          if (!patterns || patterns.length === 0) return null;
          const accentColor = SECTION_COLORS[section] ?? "bg-gray-500";
          const headerBg = SECTION_BG[section] ?? "bg-gray-50 border-gray-200";
          const isCollapsed = collapsed.has(section);
          return (
            <div key={section}>
              {/* Section header — click to collapse */}
              <button
                onClick={() => toggleSection(section)}
                className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg border mb-3 ${headerBg} hover:brightness-95 transition-all`}
              >
                <div className={`w-2 h-6 rounded-full shrink-0 ${accentColor}`} />
                <h2 className="text-sm font-bold text-gray-800">
                  {SECTION_LABELS[section] ?? section}
                </h2>
                <span className="text-xs text-gray-500">{patterns.length} pattern{patterns.length !== 1 ? "s" : ""}</span>
                <span className="ml-auto text-gray-400 text-xs">{isCollapsed ? "▶" : "▼"}</span>
              </button>

              {/* Pattern grid */}
              {!isCollapsed && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {patterns.map(p => (
                    <PatternCard key={p.id} pattern={p} accentColor={accentColor} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="text-center text-xs text-gray-400 pb-4">
          {totalShown} of {PATTERNS.length} patterns shown · NMJL 2025 card
        </div>
      </div>
    </div>
  );
}
