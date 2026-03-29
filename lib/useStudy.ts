"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { generateWall } from "@/engine/tiles";
import type { Tile } from "@/engine/tiles";
import { tileLabel, sortTiles } from "@/lib/shorthand";
import type { WinProbPoint } from "@/components/WinProbChart";

export const STUDY_SEATS = ["E", "S", "W", "N"] as const;
export const SEAT_LABELS: Record<string, string> = { E: "East", S: "South", W: "West", N: "North" };

export interface PlayerSnapshot {
  seat: string;
  hand: Tile[];           // sorted hand at this point in the game
  winProb: number;
  isActive: boolean;      // this seat made the current move
  discardedTile: Tile | null; // tile they just discarded (current move only)
}

// =============================================================================
// Types matching the API / Prisma schema
// =============================================================================

export interface SavedTileEvent {
  id: string;
  tileId: string;
  fromState: string;
  toState: string;
  actor: string;
}

export interface SavedMove {
  id: string;
  turn: number;
  player: string;
  action: string;
  tileId: string;
  handBefore: string;   // JSON string of tile ID array
  winProbBefore: number;
  winProbAfter: number;
  commentary: string | null;
  tileEvents: SavedTileEvent[];
}

export interface SavedGame {
  id: string;
  mode: string;
  createdAt: string;
  finishedAt: string | null;
  winner: string | null;
  moves?: SavedMove[];
  _count?: { moves: number };
}

// =============================================================================
// Build a tile lookup map from the canonical wall
// =============================================================================

let _tileLookup: Map<string, Tile> | null = null;
function getTileLookup(): Map<string, Tile> {
  if (!_tileLookup) {
    _tileLookup = new Map(generateWall().map(t => [t.id, t]));
  }
  return _tileLookup;
}

/** Reconstruct ordered Tile[] from a JSON-serialised array of tile IDs. */
export function tilesFromJson(handBeforeJson: string): Tile[] {
  try {
    const ids: string[] = JSON.parse(handBeforeJson);
    const lookup = getTileLookup();
    return ids.map(id => lookup.get(id)).filter(Boolean) as Tile[];
  } catch {
    return [];
  }
}

// =============================================================================
// Hook
// =============================================================================

export function useStudy() {
  const [games, setGames] = useState<SavedGame[]>([]);
  const [selectedGame, setSelectedGame] = useState<SavedGame | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeedMs, setPlaySpeedMs] = useState(800);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load game list ────────────────────────────────────────────────────────

  const loadGames = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/games");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SavedGame[] = await res.json();
      setGames(data);
    } catch (e) {
      setError("Failed to load games.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => { loadGames(); }, [loadGames]);

  // ── Select + load a game ──────────────────────────────────────────────────

  const selectGame = useCallback(async (id: string) => {
    setIsPlaying(false);
    setCurrentIndex(0);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SavedGame = await res.json();
      setSelectedGame(data);
    } catch (e) {
      setError("Failed to load game.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearGame = useCallback(() => {
    setIsPlaying(false);
    setSelectedGame(null);
    setCurrentIndex(0);
  }, []);

  // ── Playback controls ─────────────────────────────────────────────────────

  const moves = selectedGame?.moves ?? [];
  const totalMoves = moves.length;

  const next = useCallback(() => {
    setCurrentIndex(i => Math.min(i + 1, totalMoves - 1));
  }, [totalMoves]);

  const prev = useCallback(() => {
    setCurrentIndex(i => Math.max(i - 1, 0));
  }, []);

  const seek = useCallback((turn: number) => {
    const idx = moves.findIndex(m => m.turn === turn);
    if (idx >= 0) setCurrentIndex(idx);
  }, [moves]);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);

  // Auto-advance during playback
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!isPlaying || currentIndex >= totalMoves - 1) {
      setIsPlaying(false);
      return;
    }
    timerRef.current = setTimeout(next, playSpeedMs);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentIndex, totalMoves, playSpeedMs, next]);

  // ── Derived state for the UI ──────────────────────────────────────────────

  const currentMove = moves[currentIndex] ?? null;

  const currentHand = useMemo(
    () => currentMove ? tilesFromJson(currentMove.handBefore) : [],
    [currentMove]
  );

  const discardedTile = useMemo(() => {
    if (!currentMove) return null;
    return getTileLookup().get(currentMove.tileId) ?? null;
  }, [currentMove]);

  const chartData: WinProbPoint[] = useMemo(
    () =>
      moves.map(m => {
        const tile = getTileLookup().get(m.tileId);
        return {
          turn: m.turn,
          probBefore: m.winProbBefore,
          probAfter: m.winProbAfter,
          action: m.action,
          tileLabel: tile ? tileLabel(tile.suit, tile.val) : m.tileId,
        };
      }),
    [moves]
  );

  // Per-player hand + win prob snapshot at the current move index
  const playerSnapshots = useMemo((): PlayerSnapshot[] => {
    if (!moves.length) return STUDY_SEATS.map(seat => ({ seat, hand: [], winProb: 0, isActive: false, discardedTile: null }));
    return STUDY_SEATS.map(seat => {
      // Walk backward from currentIndex to find the last move this seat made
      const startIdx = Math.min(currentIndex, moves.length - 1);
      let lastMoveIdx = -1;
      for (let i = startIdx; i >= 0; i--) {
        if (moves[i].player === seat) { lastMoveIdx = i; break; }
      }
      if (lastMoveIdx === -1) {
        return { seat, hand: [], winProb: 0, isActive: false, discardedTile: null };
      }
      const m = moves[lastMoveIdx];
      const isActive = lastMoveIdx === currentIndex;
      const handBefore = tilesFromJson(m.handBefore);
      const discardTile = getTileLookup().get(m.tileId) ?? null;

      if (isActive) {
        // Show hand before the discard with the discarded tile still in it
        return {
          seat, isActive, discardedTile: discardTile,
          hand: sortTiles(handBefore),
          winProb: m.winProbBefore,
        };
      } else {
        // Show hand after the discard
        return {
          seat, isActive: false, discardedTile: null,
          hand: sortTiles(handBefore.filter(t => t.id !== m.tileId)),
          winProb: m.winProbAfter,
        };
      }
    });
  }, [moves, currentIndex]);

  // Combined chart data: one row per recorded turn, one column per seat
  // Each seat's prob is carried forward from its last discard
  const multiChartData = useMemo(() => {
    if (!moves.length) return [];
    const running: Record<string, number> = { E: 0, S: 0, W: 0, N: 0 };
    const points: Array<{ turn: number } & Record<string, number>> = [];
    for (const m of moves) {
      running[m.player] = m.winProbBefore;
      points.push({ turn: m.turn, ...running });
    }
    return points;
  }, [moves]);

  // Best and worst discard moments
  const keyMoments = useMemo(() => {
    if (!moves.length) return { bestDiscard: null, worstDiscard: null };
    const discards = moves.filter(m => m.action === "discard");
    if (!discards.length) return { bestDiscard: null, worstDiscard: null };
    const best  = discards.reduce((a, b) => (b.winProbAfter - b.winProbBefore) > (a.winProbAfter - a.winProbBefore) ? b : a);
    const worst = discards.reduce((a, b) => (b.winProbAfter - b.winProbBefore) < (a.winProbAfter - a.winProbBefore) ? b : a);
    return { bestDiscard: best, worstDiscard: worst };
  }, [moves]);

  return {
    // Game list
    games,
    loadGames,
    loading,
    error,

    // Selected game
    selectedGame,
    selectGame,
    clearGame,

    // Playback
    moves,
    totalMoves,
    currentIndex,
    currentMove,
    currentHand,
    discardedTile,
    isPlaying,
    playSpeedMs,
    setPlaySpeedMs,
    next,
    prev,
    seek,
    play,
    pause,

    // Chart + analysis
    chartData,
    multiChartData,
    playerSnapshots,
    keyMoments,
  };
}
