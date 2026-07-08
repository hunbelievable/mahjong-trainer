// Augment the Auth.js Session so `session.user.id` is typed everywhere.
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
