"use server";

import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import {
  clearFailures,
  getLockoutState,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  recordFailedAttempt,
} from "@/lib/auth/lockout";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { sendEmail } from "@/lib/email/send";
import { pickLocale } from "@/lib/i18n";

// Sign-in Server Action wrapping Better Auth's emailAndPassword flow with
// per-account lockout (M16 Phase B). The IP-per-minute limiter on
// /api/auth/sign-in/* (added in Phase A) still runs in the proxy, but
// since we now hit `auth.api.signInEmail` instead of going through that
// route, the proxy gate doesn't apply here. The lockout below is the
// per-account complement.
//
// Cookie handling: `nextCookies()` is registered on the Better Auth
// instance, so a successful `auth.api.signInEmail` call automatically
// sets the session cookie via Next.js `cookies()`.

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export type SignInResult =
  | { ok: true }
  | { ok: false; error: string; locked?: false; unverified?: false }
  | { ok: false; error: string; locked: true; retryMinutes: number }
  | { ok: false; error: string; unverified: true };

function lockedResult(retryAt: number): SignInResult {
  const minutes = Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000));
  return {
    ok: false,
    locked: true,
    retryMinutes: minutes,
    error: `Account locked. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  };
}

// Return a copy of the request headers with every Better Auth cookie removed.
// A stale/invalid session cookie (one signed with a previous
// BETTER_AUTH_SECRET, or pointing at a session that was since deleted) makes
// `signInEmail` error while it tries to read the existing session — which the
// caller then mislabels as "invalid credentials". Stripping the cookie makes
// the sign-in behave exactly like a fresh/incognito browser. Non-auth cookies
// (e.g. Turnstile) and all other headers (Origin → CSRF, X-Forwarded-For) are
// preserved.
function stripAuthCookies(h: Headers): Headers {
  const cleaned = new Headers();
  h.forEach((value, key) => {
    if (key.toLowerCase() !== "cookie") cleaned.set(key, value);
  });
  const cookie = h.get("cookie");
  if (cookie) {
    const kept = cookie
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c.length > 0 && !/better-auth/i.test(c.split("=", 1)[0]));
    if (kept.length > 0) cleaned.set("cookie", kept.join("; "));
  }
  return cleaned;
}

export async function signInWithLockout(
  rawEmail: string,
  rawPassword: string,
  // When false, Better Auth issues a NON-persistent session (cleared when the
  // browser closes). Defaults to true to preserve the prior behaviour.
  rememberMe = true,
): Promise<SignInResult> {
  const parsed = schema.safeParse({ email: rawEmail, password: rawPassword });
  if (!parsed.success) {
    return { ok: false, error: "Invalid email or password" };
  }
  const { email, password } = parsed.data;

  // 1. Pre-check the lockout flag.
  const state = await getLockoutState(email);
  if (state.locked && state.retryAt) {
    return lockedResult(state.retryAt);
  }

  // 2. Attempt sign-in. Better Auth throws on bad credentials AND on
  // unverified email (which throws with `EMAIL_NOT_VERIFIED`). The
  // two cases need different UX:
  //   - bad creds → generic message (no info leak)
  //   - unverified → tell the user to check their inbox; Better Auth
  //     has already re-sent the verification email automatically via
  //     `emailVerification.sendOnSignIn`.
  let signInOk = false;
  let unverified = false;
  try {
    await auth.api.signInEmail({
      body: { email, password, rememberMe },
      // Strip any stale Better Auth cookie so an old session can't poison
      // the sign-in (see `stripAuthCookies`).
      headers: stripAuthCookies(await headers()),
    });
    signInOk = true;
  } catch (err) {
    const code = (err as { body?: { code?: string } } | undefined)?.body
      ?.code;
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (code === "EMAIL_NOT_VERIFIED" || msg.includes("not verified")) {
      unverified = true;
    } else if (
      code === "INVALID_EMAIL_OR_PASSWORD" ||
      code === "INVALID_PASSWORD" ||
      /invalid\s+(email|password|credentials)/.test(msg)
    ) {
      // Genuine bad credentials — fall through to record the failed attempt.
    } else {
      // Anything else (transient DB hiccup, stale-cookie parse error, etc.)
      // is NOT the user's fault: don't claim the password is wrong and don't
      // count it toward the lockout. Ask them to retry.
      console.error("[signInWithLockout] unexpected sign-in error:", err);
      return {
        ok: false,
        error: "Something went wrong signing you in. Please try again.",
      };
    }
  }

  if (unverified) {
    return {
      ok: false,
      unverified: true,
      error: "Please confirm your email before signing in. We've re-sent the confirmation link.",
    };
  }

  if (signInOk) {
    await clearFailures(email);
    // Clear any persisted lock on the user row + bump lastLoginAt.
    await db
      .update(users)
      .set({ lockedUntil: null, lastLoginAt: sql`now()` })
      .where(eq(users.email, email));
    return { ok: true };
  }

  // 3. Record the failure. If this trips the lock, send the
  //    notification email + persist `users.locked_until` + audit.
  const recorded = await recordFailedAttempt(email);
  if (recorded.justLocked && recorded.retryAt) {
    const retryAt = new Date(recorded.retryAt);
    // Persist the lock on the user row for admin visibility.
    const [target] = await db
      .update(users)
      .set({ lockedUntil: retryAt })
      .where(eq(users.email, email))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        language: users.language,
      });

    // Notify the user by email (best-effort) — only if we have a real
    // account. Sending to a non-existent email is wasted noise.
    if (target) {
      try {
        await sendEmail({
          to: target.email,
          template: {
            template: "account_lockout",
            data: {
              userName: target.name,
              attempts: MAX_FAILED_ATTEMPTS,
              minutes: Math.ceil(LOCKOUT_DURATION_MS / 60_000),
            },
          },
          locale: pickLocale(target.language) ?? undefined,
        });
      } catch (err) {
        console.error("[signInWithLockout] lockout email failed:", err);
      }

      await audit({
        actorId: null,
        action: "user.locked",
        targetType: "user",
        targetId: target.id,
        after: {
          email: target.email,
          attempts: MAX_FAILED_ATTEMPTS,
          retryAt: retryAt.toISOString(),
        },
      });
    }

    return lockedResult(recorded.retryAt);
  }

  if (recorded.locked && recorded.retryAt) {
    // Already locked when we recorded — surface the same locked message.
    return lockedResult(recorded.retryAt);
  }

  return { ok: false, error: "Invalid email or password" };
}
