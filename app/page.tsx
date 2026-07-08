import Link from "next/link";

const MODES = [
  {
    href: "/live",
    label: "Live",
    color: "bg-blue-600 hover:bg-blue-700",
    badge: "bg-blue-100 text-blue-700",
    description: "Track your own hand and get real-time coaching on what to discard.",
  },
  {
    href: "/simulation",
    label: "Simulation",
    color: "bg-amber-600 hover:bg-amber-700",
    badge: "bg-amber-100 text-amber-700",
    description: "Play against three CPU opponents at adjustable difficulty levels.",
  },
  {
    href: "/observe",
    label: "Observe",
    color: "bg-teal-600 hover:bg-teal-700",
    badge: "bg-teal-100 text-teal-700",
    description: "Watch four CPU players compete to study strategy and hand development.",
  },
  {
    href: "/study",
    label: "Study",
    color: "bg-violet-600 hover:bg-violet-700",
    badge: "bg-violet-100 text-violet-700",
    description: "Replay saved games turn-by-turn with win probability charts and key moments.",
  },
  {
    href: "/patterns",
    label: "Patterns",
    color: "bg-rose-600 hover:bg-rose-700",
    badge: "bg-rose-100 text-rose-700",
    description: "Browse the NMJL 2025 card — every winning hand with tile breakdowns and point values.",
  },
  {
    href: "/multiplayer",
    label: "Multiplayer",
    color: "bg-indigo-600 hover:bg-indigo-700",
    badge: "bg-indigo-100 text-indigo-700",
    description: "Play a real game with friends, each on their own browser — open seats fill with CPUs.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Mahjong Trainer</h1>
          <p className="mt-1 text-sm text-gray-500">American Mahjong (NMJL) — pick a mode to begin</p>
        </div>

        <div className="space-y-3">
          {MODES.map(m => (
            <Link
              key={m.href}
              href={m.href}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-3 mb-1">
                <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${m.badge}`}>
                  {m.label}
                </span>
              </div>
              <p className="text-sm text-gray-600">{m.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
