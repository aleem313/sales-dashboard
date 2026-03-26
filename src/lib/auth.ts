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

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBuffer(salt) as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    512
  );
  return bufferToHex(derived) === hash;
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

        // 1. Check agents table first (agent login)
        const agent = await getAgentByEmail(email);
        if (agent && (await verifyPassword(password, agent.password_hash))) {
          return {
            id: agent.id,
            email: email,
            name: agent.name,
            role: "agent",
            agentId: agent.id,
          };
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
