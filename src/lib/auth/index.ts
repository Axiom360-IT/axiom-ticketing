import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { db } from "../db/client";
import {
  accounts,
  sessions,
  twoFactors,
  users,
  verifications,
} from "../db/schema/auth";

// Note: passkey plugin is NOT enabled in M1. The schema columns exist for
// when we add it (likely in M14 — Profile page). For MVP login, password +
// TOTP is sufficient.

// Origins allowed to send authenticated requests (CSRF protection).
// In production this is just the configured app URL.
// In development we also trust the common dev ports — Next.js will pick the
// next free one if 3000 is taken.
const trustedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.BETTER_AUTH_URL,
  ...(process.env.NODE_ENV !== "production"
    ? [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:3003",
      ]
    : []),
].filter((u): u is string => Boolean(u));

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      account: accounts,
      session: sessions,
      verification: verifications,
      twoFactor: twoFactors,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    // Email verification turns on once Resend is wired up in M3.
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7-day absolute max (customer default)
    // Refresh on every 5 min of activity. Combined with the 12-hour idle check
    // in the admin layout, this gives an effective 12h idle timeout for
    // /admin/* routes while preserving the 7-day customer session lifetime.
    updateAge: 60 * 5,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  user: {
    additionalFields: {
      language: { type: "string", defaultValue: "en" },
      isActive: { type: "boolean", defaultValue: true },
      // createdById, deactivatedAt, deactivatedById, lastLoginAt are
      // application-managed columns; Better Auth ignores them.
    },
  },
  // Override Better Auth's default ID generator (custom alphanumeric, ~32 chars)
  // with UUID v4 to match our `uuid` PK columns.
  advanced: {
    database: {
      generateId: () => randomUUID(),
    },
  },
  trustedOrigins,
  // `nextCookies()` last so its `after` hook runs after every other plugin
  // — it forwards Set-Cookie from `auth.api.*` calls in Server Actions
  // (e.g. signInWithLockout) onto the Next.js response.
  plugins: [twoFactor({ issuer: "Axiom360 Ticketing" }), nextCookies()],
});

export type Auth = typeof auth;
