import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/currentUser";
import { getLeagueDetail, getPlayerHistory, isLeagueMember } from "@/lib/server/league";

export default async function PlayerHistoryPage({ params }: { params: { id: string; userId: string } }) {
  const user = await currentUser();
  if (!user) redirect("/league");
  if (!(await isLeagueMember(params.id, user.id))) redirect("/league");

  const [league, history] = await Promise.all([
    getLeagueDetail(params.id),
    getPlayerHistory(params.id, params.userId),
  ]);
  if (!league || !history) redirect(`/league/${params.id}`);

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center px-4 py-10">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <Link href={`/league/${league.id}`} className="text-xs text-gray-400 hover:text-gray-600">
            ← {league.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{history.handle ?? history.email}</h1>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-1 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">All-time total</p>
          <p
            className={`text-3xl font-mono font-bold ${
              history.allTimeTotal > 0
                ? "text-emerald-600"
                : history.allTimeTotal < 0
                  ? "text-rose-600"
                  : "text-gray-400"
            }`}
          >
            {history.allTimeTotal > 0 ? "+" : ""}
            {history.allTimeTotal}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">By season</h2>
          {history.seasons.length === 0 ? (
            <p className="text-xs text-gray-400">No scores recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {history.seasons.map((s) => (
                <li key={s.seasonId} className="flex items-center justify-between text-sm">
                  <Link
                    href={`/league/${league.id}/seasons/${s.seasonId}`}
                    className="font-medium text-gray-800 hover:text-indigo-600"
                  >
                    {s.seasonName}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{s.sessionsPlayed} played</span>
                    <span
                      className={`font-mono font-semibold ${
                        s.totalPoints > 0 ? "text-emerald-600" : s.totalPoints < 0 ? "text-rose-600" : "text-gray-400"
                      }`}
                    >
                      {s.totalPoints > 0 ? "+" : ""}
                      {s.totalPoints}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
