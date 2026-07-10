import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/currentUser";
import { getLeagueDetail, isLeagueMember } from "@/lib/server/league";
import AddMemberForm from "./AddMemberForm";
import CreateSeasonForm from "./CreateSeasonForm";

export default async function LeagueDetailPage({ params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) redirect("/league");

  if (!(await isLeagueMember(params.id, user.id))) redirect("/league");

  const league = await getLeagueDetail(params.id);
  if (!league) redirect("/league");

  const isCommissioner = league.commissionerUserId === user.id;

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center px-4 py-10">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <Link href="/league" className="text-xs text-gray-400 hover:text-gray-600">
            ← All leagues
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{league.name}</h1>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Members</h2>
          <ul className="space-y-1.5">
            {league.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{m.handle ?? m.email}</span>
                {m.userId === league.commissionerUserId && (
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5">
                    Commissioner
                  </span>
                )}
              </li>
            ))}
          </ul>
          {isCommissioner && <AddMemberForm leagueId={league.id} />}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Seasons</h2>
          {league.seasons.length === 0 ? (
            <p className="text-xs text-gray-400">No seasons yet.</p>
          ) : (
            <ul className="space-y-2">
              {league.seasons.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/league/${league.id}/seasons/${s.id}`}
                    className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
                  >
                    <span className="text-sm font-semibold text-gray-800">{s.name}</span>
                    <span className="text-xs text-gray-400">{s.endsAt ? "Ended" : "Open"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {isCommissioner && <CreateSeasonForm leagueId={league.id} />}
        </div>
      </div>
    </main>
  );
}
