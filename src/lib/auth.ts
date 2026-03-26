import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { NextResponse } from "next/server";
import { getAgentByGithubEmail, getAgentByEmail } from "./data";

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

// Verify PBKDF2-hashed password using Node.js crypto (dynamic import for Edge compat)
async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const { pbkdf2Sync } = await import("crypto");
  const derived = pbkdf2Sync(password, Buffer.from(salt, "hex"), 100000, 64, "sha256").toString("hex");
  return derived === hash;
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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = (credentials.email as string).toLowerCase();
        const password = credentials.password as string;

        // 1. Check agents table (agent login)
        let agent: Awaited<ReturnType<typeof getAgentByEmail>> = null;
        try {
          agent = await getAgentByEmail(email);
        } catch (err) {
          console.error("[auth] DB error in getAgentByEmail:", err);
        }

        if (agent) {
          try {
            const valid = await verifyPassword(password, agent.password_hash);
            if (valid) {
              return {
                id: agent.id,
                email: email,
                name: agent.name,
                role: "agent",
                agentId: agent.id,
              };
            }
          } catch (err) {
            console.error("[auth] verifyPassword error:", err);
          }
        }

        // 2. Fallback to admin credentials from env
        const admins = parseAdminCredentials();
        const match = admins.find(
          (u) => u.email === email && u.password === password
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
    async jwt({ token, user, profile }) {
      // On initial sign-in, user object has our custom fields from authorize()
      const u = user as Record<string, unknown> | undefined;
      if (u?.role === "agent" && u?.agentId) {
        token.role = "agent";
        token.agentId = u.agentId as string;
        return token;
      }

      // GitHub/admin flow: check agent table by email
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
