import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
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

function parseAdminCredentials(): { email: string; password: string }[] {
  const raw = process.env.ADMIN_CREDENTIALS;
  if (!raw) return [];
  return raw.split(",").map((entry) => {
    const [email, ...rest] = entry.trim().split(":");
    return { email: email.toLowerCase(), password: rest.join(":") };
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const users = parseAdminCredentials();
        const match = users.find(
          (u) =>
            u.email === (credentials.email as string).toLowerCase() &&
            u.password === credentials.password
        );
        if (!match) return null;
        return {
          id: match.email,
          email: match.email,
          name: match.email.split("@")[0],
        };
      },
    }),
    GitHub,
  ],
  pages: { signIn: "/login" },
  callbacks: {
    signIn({ account, profile }) {
      // Credentials users are already verified in authorize()
      if (account?.provider === "credentials") return true;

      const allowedEmails = process.env.ALLOWED_EMAILS;
      if (!allowedEmails) return true;

      const allowed = allowedEmails
        .split(",")
        .map((e) => e.trim().toLowerCase());
      const email = profile?.email?.toLowerCase();
      return email ? allowed.includes(email) : false;
    },
    async jwt({ token, profile, user }) {
      const email = profile?.email ?? user?.email;
      if (email && token.role === undefined) {
        const agent = await getAgentByGithubEmail(email);
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
