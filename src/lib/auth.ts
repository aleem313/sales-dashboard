import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { NextResponse } from "next/server";
import { getAgentByGithubEmail } from "./data";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: "admin" | "agent";
      agentId?: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: "admin" | "agent";
    agentId?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  pages: { signIn: "/login" },
  callbacks: {
    signIn({ profile }) {
      const allowedEmails = process.env.ALLOWED_EMAILS;
      if (!allowedEmails) return true;

      const allowed = allowedEmails
        .split(",")
        .map((e) => e.trim().toLowerCase());
      const email = profile?.email?.toLowerCase();
      return email ? allowed.includes(email) : false;
    },
    async jwt({ token, profile }) {
      // On initial sign-in, check if user is an agent
      if (profile?.email && token.role === undefined) {
        const agent = await getAgentByGithubEmail(profile.email);
        if (agent) {
          token.role = "agent";
          token.agentId = agent.id;
        } else {
          token.role = "admin";
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session?.user) {
        if (token.sub) session.user.id = token.sub;
        session.user.role = (token.role as "admin" | "agent") ?? "admin";
        if (token.agentId) session.user.agentId = token.agentId as string;
      }
      return session;
    },
  },
});

export async function requireAuth() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
