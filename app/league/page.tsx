import Link from "next/link";
import { currentUser } from "@/lib/server/currentUser";
import { listMyLeagues } from "@/lib/server/league";
import CreateLeagueForm from "./CreateLeagueForm";

export default async function LeaguePage() {
  const user = await currentUser();
  const leagues = user ? await listMyLeagues(user.id) : [];

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Leagues</h1>
          <p className="mt-1 text-sm text-gray-500">
            Run a mahjong league with your circle — manual scoring, standings, season history.
          </p>
        </div>

        {!user ? (
          <div className="bg-white rounded-xl border border-rose-200 p-6 text-center space-y-2">
            <p className="text-sm text-rose-700 font-semibold">Couldn't verify your identity.</p>
            <p className="text-xs text-gray-500">
              This app expects to be reached through the Cloudflare Access gate. If you're seeing this, check the
              CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD configuration.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Your leagues</h2>
              {leagues.length === 0 ? (
                <p className="text-xs text-gray-400">No leagues yet — create one below.</p>
              ) : (
                <ul className="space-y-2">
                  {leagues.map((l) => (
                    <li key={l.id}>
                      <Link
                        href={`/league/${l.id}`}
                        className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
                      >
                        <span className="text-sm font-semibold text-gray-800">{l.name}</span>
                        <span className="text-xs text-gray-400">
                          {l.role === "commissioner" ? "Commissioner" : "Member"} · {l.memberCount}{" "}
                          {l.memberCount === 1 ? "member" : "members"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Create a league</h2>
              <CreateLeagueForm />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
