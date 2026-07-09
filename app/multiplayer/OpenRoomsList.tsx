"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface OpenRoom {
  roomId: string;
  createdAt: number;
  seatsHuman: number;
  seatsOpen: number;
}

const POLL_MS = 5000;

function ageLabel(createdAt: number): string {
  const minutes = Math.floor((Date.now() - createdAt) / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  return `${minutes} min ago`;
}

export default function OpenRoomsList() {
  const router = useRouter();
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/rooms");
        if (!res.ok) throw new Error("failed");
        const { rooms: fetched } = (await res.json()) as { rooms: OpenRoom[] };
        if (!cancelled) {
          setRooms(fetched);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Couldn't load open rooms.");
      }
    }

    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) return <p className="text-xs text-rose-600">{error}</p>;

  if (rooms === null) {
    return <p className="text-xs text-gray-400">Loading open rooms…</p>;
  }

  if (rooms.length === 0) {
    return <p className="text-xs text-gray-400">No open rooms right now — create one below.</p>;
  }

  return (
    <ul className="space-y-2">
      {rooms.map((r) => (
        <li
          key={r.roomId}
          className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg"
        >
          <div>
            <span className="font-mono font-semibold text-sm tracking-widest text-gray-800">{r.roomId}</span>
            <span className="ml-2 text-xs text-gray-500">
              {r.seatsHuman}/4 seated · {ageLabel(r.createdAt)}
            </span>
          </div>
          <button
            onClick={() => router.push(`/play/${r.roomId}`)}
            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors"
          >
            Join
          </button>
        </li>
      ))}
    </ul>
  );
}
