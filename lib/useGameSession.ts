"use client";

import { useEffect, useRef, useCallback } from "react";
import type { SaveMovePayload } from "@/app/api/games/[id]/moves/route";

interface UseGameSessionOptions {
  mode?: string;
}

interface GameSession {
  gameId: string | null;
  saveMove: (payload: Omit<SaveMovePayload, "turn">) => void;
  finishGame: (winner?: string) => void;
}

/**
 * Creates a game session on mount, exposes saveMove() and finishGame().
 * Moves called before the game ID resolves are queued and flushed automatically.
 */
export function useGameSession({ mode = "live" }: UseGameSessionOptions = {}): GameSession {
  const gameIdRef = useRef<string | null>(null);
  const turnRef = useRef(0);
  const queueRef = useRef<Omit<SaveMovePayload, "turn">[]>([]);

  const flushQueue = useCallback((gameId: string) => {
    for (const payload of queueRef.current) {
      const body: SaveMovePayload = { ...payload, turn: turnRef.current++ };
      fetch(`/api/games/${gameId}/moves`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(err => console.error("[GameSession] Failed to save queued move:", err));
    }
    queueRef.current = [];
  }, []);

  // Create game session on mount — AbortController prevents StrictMode double-create
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(data => {
        const id = data.id ?? null;
        gameIdRef.current = id;
        if (id) flushQueue(id);
      })
      .catch(err => {
        if (err.name !== "AbortError") console.error("[GameSession] Failed to create game:", err);
      });

    return () => controller.abort();
  }, [mode, flushQueue]);

  const saveMove = useCallback((payload: Omit<SaveMovePayload, "turn">) => {
    const gameId = gameIdRef.current;
    if (!gameId) {
      queueRef.current.push(payload);
      return;
    }

    const body: SaveMovePayload = { ...payload, turn: turnRef.current++ };
    fetch(`/api/games/${gameId}/moves`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(err => console.error("[GameSession] Failed to save move:", err));
  }, []);

  const finishGame = useCallback((winner?: string) => {
    const gameId = gameIdRef.current;
    if (!gameId) return;

    fetch(`/api/games/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finishedAt: new Date().toISOString(), winner }),
    }).catch(err => console.error("[GameSession] Failed to finish game:", err));
  }, []);

  return {
    get gameId() { return gameIdRef.current; },
    saveMove,
    finishGame,
  };
}
