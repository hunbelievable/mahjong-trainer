"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinRoomForm() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function join(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed) router.push(`/play/${trimmed}`);
  }

  return (
    <form onSubmit={join} className="flex gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Room code"
        maxLength={6}
        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg uppercase tracking-widest text-center font-mono"
      />
      <button
        type="submit"
        disabled={!code.trim()}
        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm font-semibold rounded-lg transition-colors"
      >
        Join
      </button>
    </form>
  );
}
