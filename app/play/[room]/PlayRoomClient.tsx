"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import TileFace from "@/components/TileFace";
import EvalPanel from "@/components/EvalPanel";
import PatternTracker from "@/components/PatternTracker";
import { evaluateHandFromView } from "@/lib/unseenPool";
import type { PlayerId } from "@/engine/tiles";
import { SEAT_ORDER } from "@/engine/tiles";
import { CHARLESTON_STEPS, PASSES_TO } from "@/engine/gameEngine";
import type { DifficultyLevel, ClaimType } from "@/engine/cpu";
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
const CLAIM_LABELS: Record<ClaimType, string> = {
  mahjong: "Mahjong!",
  quint: "Quint",
  kong: "Kong",
  pung: "Pung",
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

  const sendWs = useCallback((body: Record<string, unknown>) => {
    wsRef.current?.send(JSON.stringify(body));
  }, []);
  const sendDiscard = useCallback((tileId: string) => sendWs({ type: "discard", tileId }), [sendWs]);
  const sendClaim = useCallback((claimType: ClaimType) => sendWs({ type: "claim", claimType }), [sendWs]);
  const sendPass = useCallback(() => sendWs({ type: "pass" }), [sendWs]);
  const sendJokerSwap = useCallback(
    (meldOwnerSeat: PlayerId, meldIndex: number, jokerTileId: string, handTileId: string) =>
      sendWs({ type: "jokerSwap", meldOwnerSeat, meldIndex, jokerTileId, handTileId }),
    [sendWs],
  );
  const sendCharlestonPass = useCallback((tileIds: string[]) => sendWs({ type: "charlestonPass", tileIds }), [sendWs]);
  const sendCharlestonStop = useCallback(() => sendWs({ type: "charlestonStop" }), [sendWs]);
  const sendCharlestonBeginSecond = useCallback(() => sendWs({ type: "charlestonBeginSecond" }), [sendWs]);

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
        {state.kind === "game" && state.view.phase === "charleston" && (
          <CharlestonPanel
            roomId={roomId}
            view={state.view}
            onStage={sendCharlestonPass}
            onStop={sendCharlestonStop}
            onBeginSecond={sendCharlestonBeginSecond}
          />
        )}
        {state.kind === "game" && state.view.phase !== "charleston" && (
          <GamePanel
            roomId={roomId}
            view={state.view}
            onDiscard={sendDiscard}
            onClaim={sendClaim}
            onPass={sendPass}
            onJokerSwap={sendJokerSwap}
          />
        )}
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
// Charleston
// =============================================================================

function CharlestonPanel({
  roomId,
  view,
  onStage,
  onStop,
  onBeginSecond,
}: {
  roomId: string;
  view: PlayerView;
  onStage: (tileIds: string[]) => void;
  onStop: () => void;
  onBeginSecond: () => void;
}) {
  const pa = view.pendingActionForYou;
  const isPass = pa?.type === "human_charleston_pass";
  const isStop = pa?.type === "human_charleston_stop";
  const step = isPass ? pa.step : -1;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A fresh step (new Charleston round) always starts with nothing selected.
  useEffect(() => setSelected(new Set()), [step]);

  const toggle = (tileId: string, isJoker: boolean) => {
    if (isJoker) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tileId)) next.delete(tileId);
      else if (next.size < 3) next.add(tileId);
      return next;
    });
  };

  if (!isPass && !isStop) {
    // Waiting on someone else's Charleston step — nothing for this seat to do yet.
    return (
      <div className="text-center text-sm text-gray-400 py-16">
        Charleston in progress — waiting on the other players…
      </div>
    );
  }

  if (isStop) {
    const cpuVotes = pa.cpuVotes;
    const others = SEAT_ORDER.filter((s) => s !== view.you);
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold text-gray-900 text-center">Room {roomId}</h1>
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-3">
          <div className="text-sm font-semibold text-amber-800">
            First Charleston complete. Play the Second Charleston?
          </div>
          <div className="text-xs text-amber-900 space-y-0.5">
            <div className="font-medium">Opponent votes:</div>
            {others.map((seat) => (
              <div key={seat} className="ml-2">
                • {SEAT_LABELS[seat]}:{" "}
                {cpuVotes[seat] ? (
                  <span className="text-rose-700 font-semibold">votes to skip</span>
                ) : (
                  <span className="text-violet-700 font-semibold">wants to play</span>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onBeginSecond}
              className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded transition-colors"
            >
              Play Second Charleston
            </button>
            <button
              onClick={onStop}
              className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold rounded transition-colors"
            >
              Vote to skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // isPass
  const stepInfo = CHARLESTON_STEPS[step];
  const passingTo = SEAT_LABELS[PASSES_TO[stepInfo?.direction ?? "right"][view.you]];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-gray-900 text-center">Room {roomId}</h1>
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <div>
          <div className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-0.5">
            Charleston {stepInfo?.charleston ?? 1} of 2
          </div>
          <h2 className="text-base font-bold text-gray-800">
            {stepInfo?.label ?? ""} — passing to <span className="text-violet-700">{passingTo}</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Select exactly 3 tiles to pass. You cannot pass jokers.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {view.yourHand.map((tile) => {
            const isJoker = tile.suit === "joker";
            const isSelected = selected.has(tile.id);
            const isDisabled = isJoker || (!isSelected && selected.size >= 3);
            return (
              <div
                key={tile.id}
                className={`rounded-md p-0.5 transition-all ${
                  isSelected ? "bg-violet-600 ring-2 ring-violet-600 scale-105 shadow-md" : ""
                }`}
              >
                <TileFace
                  suit={tile.suit}
                  val={tile.val}
                  dimmed={isDisabled && !isSelected}
                  onClick={isDisabled ? undefined : () => toggle(tile.id, isJoker)}
                  title={isJoker ? "Jokers cannot be passed" : undefined}
                />
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-400">Click to select · Purple = your selection</p>

        <div className="flex items-center gap-4">
          <span className={`text-sm font-semibold ${selected.size === 3 ? "text-violet-700" : "text-gray-500"}`}>
            {selected.size}/3 selected
          </span>
          <button
            onClick={() => onStage(Array.from(selected))}
            disabled={selected.size !== 3}
            className="px-5 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm rounded transition-colors"
          >
            Pass tiles →
          </button>
        </div>
      </div>
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
  onClaim,
  onPass,
  onJokerSwap,
}: {
  roomId: string;
  view: PlayerView;
  onDiscard: (tileId: string) => void;
  onClaim: (claimType: ClaimType) => void;
  onPass: () => void;
  onJokerSwap: (meldOwnerSeat: PlayerId, meldIndex: number, jokerTileId: string, handTileId: string) => void;
}) {
  const canDiscard = view.pendingActionForYou?.type === "human_discard";
  const claimWindow =
    view.pendingActionForYou?.type === "claim_window" ? view.pendingActionForYou : null;

  const fullHandForEval = useMemo(
    () => [...view.yourHand, ...view.yourMelds.flatMap((m) => m.tiles)],
    [view.yourHand, view.yourMelds],
  );
  const evalResult = useMemo(
    () => (fullHandForEval.length > 0 ? evaluateHandFromView(view) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view],
  );

  // Dedupe joker swaps by (meldOwnerSeat, meldIndex, jokerTileId) — only offer
  // one natural-tile option per joker, matching single-player's simplification.
  const jokerSwaps = useMemo(() => {
    const seen = new Set<string>();
    return view.yourJokerSwaps.filter((s) => {
      const key = `${s.meldOwnerSeat}:${s.meldIndex}:${s.jokerTile.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [view.yourJokerSwaps]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
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

        {/* Claim window */}
        {claimWindow && (
          <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4">
            <div className="text-sm font-bold text-amber-800 mb-2 flex items-center gap-1.5 flex-wrap">
              <span>{SEAT_LABELS[claimWindow.discardedBy]} discards</span>
              <TileFace suit={claimWindow.discard.suit} val={claimWindow.discard.val} size="xs" />
              <span>— claim it?</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {claimWindow.eligibleTypes.map((ct) => (
                <button
                  key={ct}
                  onClick={() => onClaim(ct)}
                  className={`px-4 py-1.5 rounded font-bold text-sm transition-colors ${
                    ct === "mahjong"
                      ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                      : "bg-amber-500 hover:bg-amber-600 text-white"
                  }`}
                >
                  {CLAIM_LABELS[ct]}
                </button>
              ))}
              <button
                onClick={onPass}
                className="px-4 py-1.5 rounded font-semibold text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors"
              >
                Pass
              </button>
            </div>
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

        {/* Joker swap opportunities */}
        {jokerSwaps.length > 0 && (
          <div className="rounded-lg border border-purple-200 bg-purple-50/60 p-3 space-y-2">
            <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Joker swap available</div>
            <p className="text-xs text-purple-700">
              You can swap a natural tile from your hand for a joker exposed in someone&apos;s meld.
            </p>
            <div className="space-y-1.5">
              {jokerSwaps.map((s, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-600 w-14 shrink-0">
                    {s.meldOwnerSeat === view.you ? "Your" : `${SEAT_LABELS[s.meldOwnerSeat]}'s`}
                  </span>
                  <span className="text-xs text-gray-500">give</span>
                  <TileFace suit={s.handTile.suit} val={s.handTile.val} size="xs" />
                  <span className="text-xs text-gray-500">for</span>
                  <TileFace suit="joker" val="joker" size="xs" />
                  <button
                    onClick={() => onJokerSwap(s.meldOwnerSeat, s.meldIndex, s.jokerTile.id, s.handTile.id)}
                    className="ml-auto px-2 py-0.5 text-xs font-semibold rounded bg-purple-600 hover:bg-purple-700 text-white transition-colors"
                  >
                    Swap
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* Game log */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Game Log</h2>
          <div className="text-xs text-gray-500 font-mono space-y-0.5 max-h-40 overflow-y-auto">
            {view.log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Right column: pattern alignment panel — mirrors single-player, computed
          from the redacted view via an "unseen pool" model (see lib/unseenPool.ts)
          so it never sees more than a real player watching the table would. */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Pattern Alignment</h2>
        <EvalPanel result={evalResult} handSize={fullHandForEval.length} />
        <PatternTracker hand={fullHandForEval} evalResult={evalResult} />
      </div>
    </div>
  );
}
