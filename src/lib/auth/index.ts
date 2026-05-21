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

// `baseURL` is what Better Auth uses to construct every link it emits —
// magic-link verification URLs, password-reset return URLs, OAuth callbacks.
// Without this set explicitly, Better Auth falls back to `localhost:3000` in
// any code path that runs outside a live request context (e.g. an Inngest
// step or the magic-link send hook), and customers receive emails with
// `http://localhost:3000/api/auth/magic-link/verify?...` links — broken in
// production.
//
// Resolution order:
//   1. BETTER_AUTH_URL  (explicit override; useful when the auth surface
//      lives on a different host than the public app)
//   2. NEXT_PUBLIC_APP_URL  (the canonical app origin, set in every Vercel
//      project — same value used by `getAppUrl()` for email links)
//   3. `http://localhost:3000` in dev / throw in prod
function resolveBaseURL(): string {
  const fromEnv =
    process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "BETTER_AUTH_URL or NEXT_PUBLIC_APP_URL must be set in production",
    );
  }
  return "http://localhost:3000";
}

export const auth = betterAuth({
  baseURL: resolveBaseURL(),
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
    // Customer sign-up MUST verify the email — without verification,
    // anyone could register under someone else's email and lock them
    // out of self-signup later. Staff sign-in is unaffected because
    // admin-created staff rows are inserted with `emailVerified: true`
    // (the admin's out-of-band verification of the email is what we
    // trust), and they reach a real session via the setup-invite flow.
    requireEmailVerification: true,
    // Better Auth invokes this whenever `auth.api.requestPasswordReset`
    // is called — used by both the admin "Reset password" action AND
    // by the staff-creation flow (the new user is sent here as their
    // welcome). The `flow` discriminator drives copy in the template.
    sendResetPassword: async ({ user, token }) => {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      // Carry the recipient's email alongside the token so the setup
      // server action can sign them in immediately after a successful
      // password set — saves them a second hop through the login form.
      const setupUrl = `${appUrl}/admin/setup?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
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
  emailVerification: {
    // After clicking the verify link, automatically issue a session
    // cookie so the user lands signed-in on the callbackURL. Without
    // this they'd have to sign in again after verifying.
    autoSignInAfterVerification: true,
    // If an unverified user tries to sign in, Better Auth re-sends the
    // verification email automatically. Saves them from being stuck
    // when the first email never arrives or expired.
    sendOnSignIn: true,
    // Better Auth invokes this whenever a new credential sign-up
    // requests verification (the default flow under
    // `requireEmailVerification: true`). The verify URL is built by
    // Better Auth — we just deliver it via Resend.
    sendVerificationEmail: async ({ user, url }) => {
      try {
        await sendEmail({
          to: user.email,
          template: {
            template: "customer_email_verification",
            data: { recipientName: user.name, verifyUrl: url },
          },
        });
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[sendVerificationEmail] failed:", err);
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
      // Optional E.164 phone number for SMS notifications. Empty/null
      // means the user gets no SMS; the dispatcher already gates each
      // SMS leg on `r.phone` being truthy.
      phone: { type: "string", required: false },
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
