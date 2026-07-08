import { redirect } from "next/navigation";
import { auth } from "@/auth";
import PlayRoomClient from "./PlayRoomClient";

export default async function PlayRoomPage({ params }: { params: { room: string } }) {
  const session = await auth();
  if (!session?.user) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/play/${params.room}`)}`);
  }

  return <PlayRoomClient roomId={params.room} />;
}
