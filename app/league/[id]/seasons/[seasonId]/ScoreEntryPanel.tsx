"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Member {
  userId: string;
  email: string;
  handle: string | null;
}

interface ExistingScore {
  userId: string;
  handle: string | null;
  email: string;
  points: number;
}

export default function ScoreEntryPanel({
  sessionId,
  label,
  members,
  existingScores,
  isCommissioner,
}: {
  sessionId: string;
  label: string;
  members: Member[];
  existingScores: ExistingScore[];
  isCommissioner: boolean;
}) {
  const router = useRouter();
  const existingByUser = new Map(existingScores.map((s) => [s.userId, s.points]));
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(members.map((m) => [m.userId, existingByUser.get(m.userId)?.toString() ?? ""])),
  );
  const [expanded, setExpanded] = useState(existingScores.length === 0 && isCommissioner);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const entries = members
      .filter((m) => values[m.userId]?.trim() !== "")
      .map((m) => ({ userId: m.userId, points: Number(values[m.userId]) }));
    if (entries.length === 0 || entries.some((entry) => !Number.isFinite(entry.points))) {
      setError("Enter a numeric point value for at least one player.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/sessions/${sessionId}/scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error("failed");
      setExpanded(false);
      router.refresh();
    } catch {
      setError("Couldn't save scores — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        {isCommissioner && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
          >
            {expanded ? "Done" : existingScores.length > 0 ? "Edit scores" : "Enter scores"}
          </button>
        )}
      </div>

      {expanded ? (
        <form onSubmit={save} className="space-y-2">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-600 truncate">{m.handle ?? m.email}</span>
              <input
                type="number"
                value={values[m.userId] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [m.userId]: e.target.value }))}
                placeholder="pts"
                className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
              />
            </div>
          ))}
          <button
            type="submit"
            disabled={saving}
            className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded transition-colors"
          >
            {saving ? "Saving…" : "Save scores"}
          </button>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </form>
      ) : (
        <ul className="space-y-1">
          {existingScores.length === 0 ? (
            <li className="text-xs text-gray-400 italic">No scores entered yet.</li>
          ) : (
            existingScores.map((s) => (
              <li key={s.userId} className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{s.handle ?? s.email}</span>
                <span
                  className={`font-mono font-semibold ${
                    s.points > 0 ? "text-emerald-600" : s.points < 0 ? "text-rose-600" : "text-gray-400"
                  }`}
                >
                  {s.points > 0 ? "+" : ""}
                  {s.points}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
