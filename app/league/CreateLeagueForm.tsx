"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateLeagueForm() {
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
      const res = await fetch("/api/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("failed");
      const { leagueId } = (await res.json()) as { leagueId: string };
      router.push(`/league/${leagueId}`);
    } catch {
      setError("Couldn't create a league — try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={create} className="flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="League name"
        maxLength={60}
        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
      />
      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {loading ? "Creating…" : "Create"}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </form>
  );
}
