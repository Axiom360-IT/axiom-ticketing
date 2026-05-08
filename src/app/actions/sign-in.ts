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
  | { ok: false; error: string; locked?: false }
  | { ok: false; error: string; locked: true; retryMinutes: number };

function lockedResult(retryAt: number): SignInResult {
  const minutes = Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000));
  return {
    ok: false,
    locked: true,
    retryMinutes: minutes,
    error: `Account locked. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  };
}

export async function signInWithLockout(
  rawEmail: string,
  rawPassword: string,
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

  // 2. Attempt sign-in. Better Auth throws on bad credentials.
  let signInOk = false;
  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });
    signInOk = true;
  } catch {
    // Generic — never leak whether email or password was wrong.
    signInOk = false;
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
