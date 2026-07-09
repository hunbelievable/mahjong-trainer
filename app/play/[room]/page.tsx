import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/server/currentUser";
import PlayRoomClient from "./PlayRoomClient";

export default async function PlayRoomPage({ params }: { params: { room: string } }) {
  const userId = await currentUserId();
  if (!userId) {
    // Cloudflare Access gates the whole app, so an unauthenticated request here
    // means Access verification itself failed — send them back to the landing
    // page, which surfaces that clearly instead of a confusing dead end.
    redirect("/multiplayer");
  }

  return <PlayRoomClient roomId={params.room} />;
}
