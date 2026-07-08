"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateRoomForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      const { roomId } = (await res.json()) as { roomId: string };
      router.push(`/play/${roomId}`);
    } catch {
      setError("Couldn't create a room — try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={createRoom}
        disabled={loading}
        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
      >
        {loading ? "Creating…" : "Create a room"}
      </button>
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
    </div>
  );
}
