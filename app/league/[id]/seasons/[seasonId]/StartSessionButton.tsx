"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StartSessionButton({ seasonId }: { seasonId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/seasons/${seasonId}/sessions`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
      router.refresh();
    } catch {
      setError("Couldn't start league night — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
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
