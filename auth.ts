// =============================================================================
// Auth.js (NextAuth v5) — Google sign-in backed by the Prisma adapter.
//
// Identity is the whole point here: the authenticated `user.id` is the player
// identity the RoomManager already expects (seat → userId). Database sessions
// use the User/Account/Session tables added to the Prisma schema.
//
// Requires env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET. See .env.example.
// =============================================================================

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [Google],
  callbacks: {
    // Surface the stable user id on the session so server code can read it directly.
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
});
