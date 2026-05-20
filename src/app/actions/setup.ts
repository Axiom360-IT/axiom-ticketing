"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";

// Backs the /admin/setup form. Hands the form-supplied token straight
// to Better Auth's reset-password API — Better Auth verifies the token
// (issued via `requestPasswordReset` during user creation OR a manual
// admin-triggered reset) and updates the password row. On success we
// also attempt a follow-up `auth.api.signInEmail` with the same email
// and new password so the user lands on the admin dashboard on the
// FIRST submit click rather than being bounced to the login form.
//
// Result shape is intentionally narrow: `ok: true` with a `signedIn`
// flag tells the client whether to redirect to `/admin` (signed in) or
// `/admin/login?reset=ok` (sign-in failed for some reason — the user
// can still log in manually with their new password).

const schema = z.object({
  token: z.string().trim().min(1).max(2000),
  newPassword: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(200),
  // Optional. The email is carried in the setup URL so we can auto-
  // sign-in after the reset succeeds. Absence is tolerated — older
  // links without the param still work, the user just has to log in
  // manually after the success redirect.
  email: z.string().trim().toLowerCase().email().optional(),
});

type Result =
  | { ok: true; signedIn: boolean }
  | { ok: false; error: string };

export async function setupPassword(input: {
  token: string;
  newPassword: string;
  email?: string;
}): Promise<Result> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  try {
    await auth.api.resetPassword({
      body: {
        token: parsed.data.token,
        newPassword: parsed.data.newPassword,
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[setupPassword] reset failed:", err);
    }
    // Single generic message so attackers can't distinguish "bad
    // token" from "expired token" from "weak password" without trying.
    return {
      ok: false,
      error:
        "This link is no longer valid. Ask an admin to send a new setup email.",
    };
  }

  // Auto-sign-in after a successful reset. `nextCookies()` is registered
  // on the Better Auth instance, so the response cookie is forwarded
  // onto the Next.js response — no manual cookie wiring needed.
  if (parsed.data.email) {
    try {
      await auth.api.signInEmail({
        body: {
          email: parsed.data.email,
          password: parsed.data.newPassword,
        },
        headers: await headers(),
      });
      return { ok: true, signedIn: true };
    } catch (err) {
      // Sign-in can fail for legitimate reasons (e.g. account locked
      // after recent repeated failures). The password DID get set, so
      // we still return ok — the client redirects to /admin/login and
      // the user can finish manually. Surface the cause in dev.
      if (process.env.NODE_ENV !== "production") {
        console.error("[setupPassword] auto-sign-in failed:", err);
      }
      return { ok: true, signedIn: false };
    }
  }

  return { ok: true, signedIn: false };
}
