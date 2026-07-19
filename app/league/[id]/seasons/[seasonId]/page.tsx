import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/currentUser";
import {
  getSeasonDetail,
  getLeagueDetail,
  getSeasonStandings,
  getSessionScores,
  getLinkedRooms,
  isLeagueMember,
} from "@/lib/server/league";
import StartSessionButton from "./StartSessionButton";
import ScoreEntryPanel from "./ScoreEntryPanel";
import LinkedRoomsPanel from "./LinkedRoomsPanel";

export default async function SeasonDetailPage({ params }: { params: { id: string; seasonId: string } }) {
  const user = await currentUser();
  if (!user) redirect("/league");

  if (!(await isLeagueMember(params.id, user.id))) redirect("/league");

  const [season, league, standings] = await Promise.all([
    getSeasonDetail(params.seasonId),
    getLeagueDetail(params.id),
    getSeasonStandings(params.seasonId),
  ]);
  if (!season || !league || season.leagueId !== league.id) redirect(`/league/${params.id}`);

  const isCommissioner = league.commissionerUserId === user.id;
  const sessionsWithScores = await Promise.all(
    season.sessions.map(async (s) => ({
      ...s,
      scores: await getSessionScores(s.id),
      rooms: await getLinkedRooms(s.id),
    })),
  );

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center px-4 py-10">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <Link href={`/league/${league.id}`} className="text-xs text-gray-400 hover:text-gray-600">
            ← {league.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{season.name}</h1>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Standings</h2>
          {standings.length === 0 ? (
            <p className="text-xs text-gray-400">No scores entered yet.</p>
          ) : (
            <ol className="space-y-1.5">
              {standings.map((row, i) => (
                <li key={row.userId} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                    <Link
                      href={`/league/${league.id}/players/${row.userId}`}
                      className="font-medium text-gray-800 hover:text-indigo-600"
                    >
                      {row.handle ?? row.email}
                    </Link>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{row.sessionsPlayed} played</span>
                    <span
                      className={`font-mono font-semibold ${
                        row.totalPoints > 0 ? "text-emerald-600" : row.totalPoints < 0 ? "text-rose-600" : "text-gray-400"
                      }`}
                    >
                      {row.totalPoints > 0 ? "+" : ""}
                      {row.totalPoints}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">League nights</h2>
            {isCommissioner && <StartSessionButton seasonId={season.id} />}
          </div>
          {sessionsWithScores.length === 0 ? (
            <p className="text-xs text-gray-400">No league nights yet.</p>
          ) : (
            <div className="space-y-4">
              {sessionsWithScores.map((s) => (
                <div key={s.id} className="border border-gray-200 rounded-lg p-3">
                  <ScoreEntryPanel
                    sessionId={s.id}
                    label={s.label ?? new Date(s.scheduledAt).toLocaleDateString()}
                    members={league.members}
                    existingScores={s.scores}
                    isCommissioner={isCommissioner}
                  />
                  <LinkedRoomsPanel sessionId={s.id} rooms={s.rooms} isCommissioner={isCommissioner} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
