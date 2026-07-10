"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddMemberForm({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) throw new Error("failed");
      setEmail("");
      router.refresh();
    } catch {
      setError("Couldn't add that member — already added, or something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={add} className="flex gap-2 pt-2 border-t border-gray-100">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Add member by email"
        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
      />
      <button
        type="submit"
        disabled={loading || !email.trim()}
        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-xs font-semibold rounded-lg transition-colors"
      >
        {loading ? "Adding…" : "Add"}
      </button>
      {error && <p className="text-xs text-rose-600 w-full">{error}</p>}
    </form>
  );
}
