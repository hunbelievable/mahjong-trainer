"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HandleForm({ initialHandle }: { initialHandle: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initialHandle ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: value }),
      });
      if (!res.ok) throw new Error("failed");
      router.refresh();
    } catch {
      setError("Couldn't save your handle — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Rusty"
        maxLength={24}
        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
      />
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm font-semibold rounded-lg transition-colors"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </form>
  );
}
