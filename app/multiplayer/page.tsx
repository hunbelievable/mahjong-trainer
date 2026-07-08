import Link from "next/link";
import { auth, signOut } from "@/auth";
import CreateRoomForm from "./CreateRoomForm";
import JoinRoomForm from "./JoinRoomForm";

export default async function MultiplayerPage() {
  const session = await auth();

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Multiplayer</h1>
          <p className="mt-1 text-sm text-gray-500">
            Play a real game with friends across browsers — open seats fill with CPUs.
          </p>
        </div>

        {!session?.user ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center space-y-3">
            <p className="text-sm text-gray-600">Sign in to create or join a room.</p>
            <Link
              href="/api/auth/signin"
              className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
              <span className="text-sm text-gray-600">
                Signed in as <span className="font-semibold text-gray-800">{session.user.email ?? session.user.name}</span>
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/multiplayer" });
                }}
              >
                <button type="submit" className="text-xs text-gray-400 hover:text-gray-600 underline">
                  Sign out
                </button>
              </form>
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
