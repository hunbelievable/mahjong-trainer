// Server-side helper: the authenticated user id for the current request, or null.
// This is the identity the RoomManager / gateway use to authorize seat actions.
import { auth } from "@/auth";

export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
