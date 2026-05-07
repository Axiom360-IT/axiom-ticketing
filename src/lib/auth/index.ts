import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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
    expiresIn: 60 * 60 * 24 * 7, // 7 days (customer default)
    updateAge: 60 * 60 * 24, // refresh sliding expiry once per day
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
  plugins: [twoFactor({ issuer: "Axiom360 Ticketing" })],
});

export type Auth = typeof auth;
