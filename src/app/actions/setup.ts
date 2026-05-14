"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";

// Backs the /admin/setup form. Hands the form-supplied token straight
// to Better Auth's reset-password API — Better Auth verifies the token
// (issued via `requestPasswordReset` during user creation OR a manual
// admin-triggered reset) and updates the password row. Result is
// always a generic shape so token validity can't be probed by error
// comparison.

const schema = z.object({
  token: z.string().trim().min(1).max(2000),
  newPassword: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(200),
});

type Result = { ok: true } | { ok: false; error: string };

export async function setupPassword(input: {
  token: string;
  newPassword: string;
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
    return { ok: true };
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
}
