"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import TileFace from "@/components/TileFace";
import type { PlayerId } from "@/engine/tiles";
import { SEAT_ORDER } from "@/engine/tiles";
import type { DifficultyLevel } from "@/engine/cpu";
// Type-only imports from server modules — erased at compile time, so none of
// their runtime code (Prisma, nats, etc.) ends up in the client bundle.
import type { PlayerView } from "@/lib/server/redact";
import type { LobbyView } from "@/lib/server/roomManager";

const SEAT_LABELS: Record<PlayerId, string> = { E: "East", S: "South", W: "West", N: "North" };
const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

type ClientState =
  | { kind: "connecting" }
  | { kind: "lobby"; view: LobbyView }
  | { kind: "game"; view: PlayerView }
  | { kind: "error"; message: string; retryable: boolean };

const MAX_RETRIES = 5;

export default function PlayRoomClient({ roomId }: { roomId: string }) {
  const [state, setState] = useState<ClientState>({ kind: "connecting" });
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws?room=${encodeURIComponent(roomId)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCountRef.current = 0;
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(ev.data as string) as
            | { type: "lobby"; view: LobbyView }
            | { type: "game"; view: PlayerView }
            | { type: "error"; message: string };
          if (msg.type === "lobby") setState({ kind: "lobby", view: msg.view });
          else if (msg.type === "game") setState({ kind: "game", view: msg.view });
          else setState({ kind: "error", message: msg.message, retryable: false });
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = (ev) => {
        if (cancelled) return;
        // 4001 = "not seated" (wsHub) — permanent for this session, don't retry.
        if (ev.code === 4001) {
          setState({ kind: "error", message: "You're not seated in this game.", retryable: false });
          return;
        }
        if (retryCountRef.current >= MAX_RETRIES) {
          setState({ kind: "error", message: "Lost connection to the room.", retryable: true });
          return;
        }
        retryCountRef.current += 1;
        setState({ kind: "connecting" });
        retryTimer = setTimeout(connect, 1500);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, retryTick]);

  const sendAction = useCallback(
    async (body: Record<string, unknown>) => {
      await fetch(`/api/rooms/${roomId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // The server broadcasts the updated view over WS on success; nothing to do here.
    },
    [roomId],
  );

  const sendDiscard = useCallback((tileId: string) => {
    wsRef.current?.send(JSON.stringify({ type: "discard", tileId }));
  }, []);

  const manualRetry = () => {
    retryCountRef.current = 0;
    setRetryTick((t) => t + 1);
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="max-w-3xl mx-auto">
        {state.kind === "connecting" && (
          <div className="text-center text-sm text-gray-400 py-16">Connecting to room {roomId}…</div>
        )}

        {state.kind === "error" && (
          <div className="bg-white rounded-xl border border-rose-200 p-6 text-center space-y-3">
            <p className="text-sm text-rose-700 font-semibold">{state.message}</p>
            {state.retryable && (
              <button
                onClick={manualRetry}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {state.kind === "lobby" && <LobbyPanel roomId={roomId} view={state.view} onAction={sendAction} />}
        {state.kind === "game" && <GamePanel roomId={roomId} view={state.view} onDiscard={sendDiscard} />}
      </div>
    </main>
  );
}

// =============================================================================
// Lobby
// =============================================================================

function LobbyPanel({
  roomId,
  view,
  onAction,
}: {
  roomId: string;
  view: LobbyView;
  onAction: (body: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Room {roomId}</h1>
        <p className="text-sm text-gray-500 mt-1">Share this code — open seats fill with CPUs when you start.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        {view.seats.map((s) => (
          <div key={s.seat} className="flex items-center justify-between gap-3 py-1">
            <span className="w-16 text-sm font-semibold text-gray-700">{SEAT_LABELS[s.seat]}</span>

            {s.kind === "human" && (
              <span className="flex-1 text-sm text-gray-600">{s.isYou ? "You" : "Another player"}</span>
            )}
            {(s.kind === "open" || s.kind === "cpu") && (
              <span className="flex-1 text-sm text-gray-400">
                {s.kind === "cpu" ? `CPU · ${DIFFICULTY_LABELS[s.difficulty!]}` : "Open"}
              </span>
            )}

            <div className="flex items-center gap-2 shrink-0">
              {(s.kind === "open" || s.kind === "cpu") && (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) onAction({ action: "setCpu", seat: s.seat, difficulty: e.target.value });
                    e.target.value = "";
                  }}
                  className="text-xs border border-gray-300 rounded px-1.5 py-1"
                >
                  <option value="" disabled>
                    Set CPU…
                  </option>
                  {(Object.keys(DIFFICULTY_LABELS) as DifficultyLevel[]).map((d) => (
                    <option key={d} value={d}>
                      {DIFFICULTY_LABELS[d]}
                    </option>
                  ))}
                </select>
              )}
              {s.kind === "open" && (
                <button
                  onClick={() => onAction({ action: "claimSeat", seat: s.seat })}
                  className="text-xs px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                >
                  Sit here
                </button>
              )}
              {s.kind === "human" && s.isYou && (
                <button
                  onClick={() => onAction({ action: "releaseSeat" })}
                  className="text-xs px-2.5 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold"
                >
                  Leave seat
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => onAction({ action: "start" })}
        disabled={view.yourSeat === null}
        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold rounded-lg transition-colors"
        title={view.yourSeat === null ? "Claim a seat first" : undefined}
      >
        Start game
      </button>
    </div>
  );
}

// =============================================================================
// Game
// =============================================================================

/** Face-down opponent tiles — single-player never needed a "tile back," so this is local to the multiplayer view. */
function TileBack({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5 flex-wrap">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="w-9 h-12 rounded-md border border-stone-400 bg-gradient-to-br from-stone-600 to-stone-700 shadow-sm"
        />
      ))}
    </div>
  );
}

function GamePanel({
  roomId,
  view,
  onDiscard,
}: {
  roomId: string;
  view: PlayerView;
  onDiscard: (tileId: string) => void;
}) {
  const canDiscard = view.pendingActionForYou?.type === "human_discard";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Room {roomId}</h1>
        <span className="text-xs text-gray-500">
          Turn {view.turnNumber} · {SEAT_LABELS[view.currentSeat]}
          {view.currentSeat === view.you ? " (you)" : ""}
        </span>
      </div>

      {view.winner && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-4 text-center">
          <p className="font-bold text-emerald-800">
            {view.winner === view.you ? "You won!" : `${SEAT_LABELS[view.winner]} wins.`}
          </p>
          {view.winningPattern && <p className="text-sm text-emerald-700 mt-1">{view.winningPattern.name}</p>}
        </div>
      )}
      {!view.winner && view.phase === "finished" && (
        <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 text-center text-sm text-gray-600">
          Wall exhausted — no winner.
        </div>
      )}

      {/* Opponents */}
      <div className="grid grid-cols-3 gap-3">
        {view.opponents.map((o) => (
          <div
            key={o.seat}
            className={`bg-white rounded-lg border p-2 space-y-1 ${
              o.seat === view.currentSeat ? "border-indigo-400 ring-1 ring-indigo-200" : "border-gray-200"
            }`}
          >
            <div className="text-xs font-semibold text-gray-600">{SEAT_LABELS[o.seat]}</div>
            <TileBack count={o.handCount} />
            {o.melds.length > 0 && (
              <div className="flex gap-1 flex-wrap pt-1 border-t border-gray-100">
                {o.melds.flatMap((m) => m.tiles).map((t) => (
                  <TileFace key={t.id} suit={t.suit} val={t.val} size="xs" />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Your hand */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">
          Your hand{canDiscard ? " — click a tile to discard" : ""}
        </h2>
        <div className="flex gap-1 flex-wrap min-h-12">
          {view.yourHand.map((t) => (
            <div
              key={t.id}
              className={t.id === view.yourFreshTileId ? "ring-2 ring-cyan-400 ring-offset-1 rounded-md p-0.5" : undefined}
            >
              <TileFace suit={t.suit} val={t.val} onClick={canDiscard ? () => onDiscard(t.id) : undefined} />
            </div>
          ))}
        </div>
        {view.yourMelds.length > 0 && (
          <div className="flex gap-1 flex-wrap pt-2 border-t border-gray-100">
            {view.yourMelds.flatMap((m) => m.tiles).map((t) => (
              <TileFace key={t.id} suit={t.suit} val={t.val} size="xs" />
            ))}
          </div>
        )}
      </div>

      {/* Discards */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Discards</h2>
        {SEAT_ORDER.map((seat) => (
          <div key={seat} className="flex items-center gap-2">
            <span className="w-14 text-xs text-gray-500 shrink-0">{SEAT_LABELS[seat]}</span>
            <div className="flex gap-0.5 flex-wrap">
              {view.discardPile[seat]?.map((t) => (
                <TileFace key={t.id} suit={t.suit} val={t.val} size="xs" />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="text-xs text-gray-400 text-center">{view.wallCount} tiles left in wall</div>
    </div>
  );
}
