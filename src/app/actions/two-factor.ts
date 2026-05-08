"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { PRIVILEGED_PERMISSIONS } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";

// Self-service 2FA. Privileged users (anyone holding any
// PRIVILEGED_PERMISSIONS per ARCHITECTURE §13) can't disable 2FA — that
// guard lives here at the action layer; the UI hides the disable button
// based on the same check.

export async function getTwoFactorStatus(): Promise<{
  enabled: boolean;
  canDisable: boolean;
}> {
  const user = await requireSessionUser();
  const [row] = await db
    .select({ enabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const enabled = row?.enabled === true;
  const isPrivileged = PRIVILEGED_PERMISSIONS.some((p) =>
    user.permissions.has(p),
  );
  return { enabled, canDisable: !isPrivileged };
}

export type EnableTwoFactorResult =
  | { ok: true; totpUri: string; backupCodes: string[] }
  | { ok: false; error: string };

export async function enableTwoFactor(
  password: string,
): Promise<EnableTwoFactorResult> {
  const user = await requireSessionUser();
  try {
    const result = await auth.api.enableTwoFactor({
      body: { password, issuer: "Axiom360 Ticketing" },
      headers: await headers(),
    });
    // Result shape: { totpURI: string, backupCodes: string[] }
    const r = result as unknown as {
      totpURI?: string;
      backupCodes?: string[];
    };
    if (!r.totpURI) {
      return { ok: false, error: "Could not enable two-factor" };
    }
    await audit({
      actorId: user.id,
      action: "user.two_factor.enable",
      targetType: "user",
      targetId: user.id,
    });
    revalidatePath("/admin/profile");
    return {
      ok: true,
      totpUri: r.totpURI,
      backupCodes: r.backupCodes ?? [],
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not enable",
    };
  }
}

export async function verifyTotpCode(
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "Code must be 6 digits" };
  }
  try {
    await auth.api.verifyTOTP({
      body: { code },
      headers: await headers(),
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Verification failed",
    };
  }
}

export async function disableTwoFactor(
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireSessionUser();
  const isPrivileged = PRIVILEGED_PERMISSIONS.some((p) =>
    user.permissions.has(p),
  );
  if (isPrivileged) {
    return {
      ok: false,
      error: "Privileged accounts can't disable two-factor.",
    };
  }
  try {
    await auth.api.disableTwoFactor({
      body: { password },
      headers: await headers(),
    });
    await audit({
      actorId: user.id,
      action: "user.two_factor.disable",
      targetType: "user",
      targetId: user.id,
    });
    revalidatePath("/admin/profile");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not disable",
    };
  }
}

export async function regenerateBackupCodes(
  password: string,
): Promise<
  | { ok: true; backupCodes: string[] }
  | { ok: false; error: string }
> {
  const user = await requireSessionUser();
  try {
    const result = await auth.api.generateBackupCodes({
      body: { password },
      headers: await headers(),
    });
    const r = result as unknown as { backupCodes?: string[] };
    if (!r.backupCodes) {
      return { ok: false, error: "No backup codes returned" };
    }
    await audit({
      actorId: user.id,
      action: "user.two_factor.regenerate_backup_codes",
      targetType: "user",
      targetId: user.id,
    });
    return { ok: true, backupCodes: r.backupCodes };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not regenerate",
    };
  }
}
