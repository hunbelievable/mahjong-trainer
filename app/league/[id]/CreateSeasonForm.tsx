"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateSeasonForm({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/seasons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("failed");
      const { seasonId } = (await res.json()) as { seasonId: string };
      router.push(`/league/${leagueId}/seasons/${seasonId}`);
    } catch {
      setError("Couldn't create a season — try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={create} className="flex gap-2 pt-2 border-t border-gray-100">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Fall 2026"
        maxLength={60}
        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
      />
      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
      >
        {loading ? "Creating…" : "New season"}
      </button>
      {error && <p className="text-xs text-rose-600 w-full">{error}</p>}
    </form>
  );
}
