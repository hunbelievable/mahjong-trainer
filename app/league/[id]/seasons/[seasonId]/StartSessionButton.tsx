"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAX_TABLES = 10;

export default function StartSessionButton({ seasonId }: { seasonId: string }) {
  const router = useRouter();
  const [tables, setTables] = useState("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const sessionRes = await fetch(`/api/leagues/seasons/${seasonId}/sessions`, { method: "POST" });
      if (!sessionRes.ok) throw new Error("failed");
      const { sessionId: newSessionId } = (await sessionRes.json()) as { sessionId: string };

      const tableCount = Math.max(0, Math.min(MAX_TABLES, Math.floor(Number(tables)) || 0));
      for (let i = 0; i < tableCount; i++) {
        // POST /api/rooms is the existing multiplayer room-creation endpoint
        // (lib/server/roomApi.ts) — reused as-is rather than duplicating room
        // creation here, since only that path correctly shares RoomManager's
        // in-process singleton with the WS transport (see its header comment).
        const roomRes = await fetch("/api/rooms", { method: "POST" });
        if (!roomRes.ok) throw new Error("failed");
        const { roomId } = (await roomRes.json()) as { roomId: string };

        const linkRes = await fetch(`/api/leagues/sessions/${newSessionId}/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
        });
        if (!linkRes.ok) throw new Error("failed");
      }
      router.refresh();
    } catch {
      setError("Couldn't start league night — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        max={MAX_TABLES}
        value={tables}
        onChange={(e) => setTables(e.target.value)}
        className="w-14 px-2 py-1 text-xs border border-gray-300 rounded"
        title="Tables to pre-seat now (0 = just create the night, add tables later)"
      />
      <button
        onClick={start}
        disabled={loading}
        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
      >
        {loading ? "Starting…" : "Start league night"}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
