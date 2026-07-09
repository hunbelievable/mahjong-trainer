import { currentUser } from "@/lib/server/currentUser";
import CreateRoomForm from "./CreateRoomForm";
import JoinRoomForm from "./JoinRoomForm";

export default async function MultiplayerPage() {
  const user = await currentUser();

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Multiplayer</h1>
          <p className="mt-1 text-sm text-gray-500">
            Play a real game with friends across browsers — open seats fill with CPUs.
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
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <span className="text-sm text-gray-600">
                Signed in as <span className="font-semibold text-gray-800">{user.email}</span>
              </span>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Create a room</h2>
              <CreateRoomForm />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Join a room</h2>
              <JoinRoomForm />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
