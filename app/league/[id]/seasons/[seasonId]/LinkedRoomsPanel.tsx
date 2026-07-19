"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LinkedRoom {
  roomId: string;
  matchFinished: boolean;
}

export default function LinkedRoomsPanel({
  sessionId,
  rooms,
  isCommissioner,
}: {
  sessionId: string;
  rooms: LinkedRoom[];
  isCommissioner: boolean;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [addingTable, setAddingTable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function addTable() {
    setAddingTable(true);
    setMessage(null);
    try {
      const roomRes = await fetch("/api/rooms", { method: "POST" });
      if (!roomRes.ok) throw new Error("failed");
      const { roomId } = (await roomRes.json()) as { roomId: string };
      const linkRes = await fetch(`/api/leagues/sessions/${sessionId}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
      if (!linkRes.ok) throw new Error("failed");
      router.refresh();
    } catch {
      setMessage("Couldn't add a table — try again.");
    } finally {
      setAddingTable(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/leagues/sessions/${sessionId}/sync`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { syncedPlayers: number; roomsSynced: number; roomsSkipped: number };
      setMessage(
        data.roomsSkipped > 0
          ? `Synced ${data.syncedPlayers} player(s) from ${data.roomsSynced} finished table(s) — ${data.roomsSkipped} still in progress.`
          : `Synced ${data.syncedPlayers} player(s) from ${data.roomsSynced} table(s).`,
      );
      router.refresh();
    } catch {
      setMessage("Couldn't sync — try again.");
    } finally {
      setSyncing(false);
    }
  }

  if (rooms.length === 0 && !isCommissioner) return null;

  return (
    <div className="space-y-1.5 pt-1 border-t border-gray-100 mt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Tables</span>
        {isCommissioner && (
          <div className="flex items-center gap-2">
            <button onClick={addTable} disabled={addingTable} className="text-xs text-gray-500 hover:text-gray-700 font-semibold disabled:opacity-50">
              {addingTable ? "Adding…" : "+ Add table"}
            </button>
            {rooms.length > 0 && (
              <button
                onClick={sync}
                disabled={syncing}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold disabled:opacity-50"
              >
                {syncing ? "Syncing…" : "Sync scores"}
              </button>
            )}
          </div>
        )}
      </div>
      {rooms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rooms.map((r) => (
            <a
              key={r.roomId}
              href={`/play/${r.roomId}`}
              target="_blank"
              rel="noreferrer"
              className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${
                r.matchFinished
                  ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                  : "bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100"
              }`}
              title={r.matchFinished ? "Match finished — ready to sync" : "Still in progress"}
            >
              {r.roomId} {r.matchFinished ? "✓" : "…"}
            </a>
          ))}
        </div>
      )}
      {message && <p className="text-xs text-gray-500">{message}</p>}
    </div>
  );
}
