import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { assignCustomerRole, claimTicketsForCustomer } from "../customer/reconcile";
import { db } from "../db/client";
import {
  accounts,
  sessions,
  users,
  verifications,
} from "../db/schema/auth";
import { sendEmail } from "../email/send";

// 2FA is intentionally not enabled at this point — password + lockout +
// per-action re-auth covers the threat model. The Better Auth twoFactor
// plugin can be re-added later if/when we want TOTP back.

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
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    // Email verification turns on once Resend is wired up in M3.
    requireEmailVerification: false,
    // Better Auth invokes this whenever `auth.api.requestPasswordReset`
    // is called — used by both the admin "Reset password" action AND
    // by the staff-creation flow (the new user is sent here as their
    // welcome). The `flow` discriminator drives copy in the template.
    sendResetPassword: async ({ user, token }) => {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      const setupUrl = `${appUrl}/admin/setup?token=${encodeURIComponent(token)}`;
      // First-time staff don't yet have a `lastLoginAt`. We treat that
      // as "set" copy ("Welcome to Axiom360"); existing users get the
      // "reset" copy. Falls back to "set" if the field isn't on the
      // user object (Better Auth sometimes hands us a thin user shape).
      const lastLogin = (user as { lastLoginAt?: Date | null }).lastLoginAt;
      const flow: "set" | "reset" = lastLogin ? "reset" : "set";
      try {
        await sendEmail({
          to: user.email,
          template: {
            template: "staff_setup_invite",
            data: { recipientName: user.name, setupUrl, flow },
          },
        });
      } catch (err) {
        // Silent in prod (preserves the generic-success contract Better
        // Auth expects); surface in dev so failed sends aren't invisible.
        if (process.env.NODE_ENV !== "production") {
          console.error("[sendResetPassword] failed:", err);
        }
      }
    },
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
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await assignCustomerRole(user.id);
          await claimTicketsForCustomer(user.id, user.email);
        },
      },
    },
  },
  // `nextCookies()` forwards Set-Cookie from `auth.api.*` calls in
  // Server Actions (e.g. signInWithLockout) onto the Next.js response.
  plugins: [
    magicLink({
      expiresIn: 60 * 10,
      rateLimit: { window: 60 * 60, max: 3 },
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          template: { template: "customer_magic_link", data: { url } },
        });
      },
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
