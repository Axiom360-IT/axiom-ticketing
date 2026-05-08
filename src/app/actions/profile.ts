"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { notificationPreferences } from "@/lib/db/schema/notifications";
import type { NotificationEventType } from "@/inngest/client";

// ── Account info ─────────────────────────────────────────────────

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  language: z.string().trim().min(2).max(10),
});

export type UpdateProfileInput = z.infer<typeof profileSchema>;
export type UpdateProfileResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const user = await requireSessionUser();

  await db
    .update(users)
    .set({
      name: parsed.data.name,
      language: parsed.data.language,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await audit({
    actorId: user.id,
    action: "user.update_profile",
    targetType: "user",
    targetId: user.id,
    after: { name: parsed.data.name, language: parsed.data.language },
  });

  revalidatePath("/admin/profile");
  return { ok: true };
}

// ── Password change ─────────────────────────────────────────────

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const user = await requireSessionUser();
  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: input.revokeOtherSessions,
      },
      headers: await headers(),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Password change failed",
    };
  }

  await audit({
    actorId: user.id,
    action: "user.change_password",
    targetType: "user",
    targetId: user.id,
    after: { revokeOtherSessions: input.revokeOtherSessions },
  });

  return { ok: true };
}

// ── Sessions ────────────────────────────────────────────────────

export type ProfileSession = {
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
};

export async function listMySessions(): Promise<ProfileSession[]> {
  const headersList = await headers();
  const current = await auth.api.getSession({ headers: headersList });
  const list = await auth.api.listSessions({ headers: headersList });
  const currentToken = current?.session.token ?? null;

  return (list ?? []).map((s) => ({
    token: s.token,
    ipAddress: s.ipAddress ?? null,
    userAgent: s.userAgent ?? null,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
    expiresAt: new Date(s.expiresAt),
    isCurrent: currentToken === s.token,
  }));
}

export async function revokeSession(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireSessionUser();
  try {
    await auth.api.revokeSession({
      body: { token },
      headers: await headers(),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not revoke",
    };
  }
  await audit({
    actorId: user.id,
    action: "session.revoke",
    targetType: "session",
    targetId: token,
  });
  revalidatePath("/admin/profile");
  return { ok: true };
}

export async function revokeOtherSessions(): Promise<{
  ok: true;
}> {
  const user = await requireSessionUser();
  await auth.api.revokeOtherSessions({ headers: await headers() });
  await audit({
    actorId: user.id,
    action: "session.revoke_others",
    targetType: "user",
    targetId: user.id,
  });
  revalidatePath("/admin/profile");
  return { ok: true };
}

// ── Notification preferences ────────────────────────────────────

const KNOWN_EVENT_TYPES = new Set<NotificationEventType>([
  "ticket.assigned",
  "ticket.customer_replied",
  "ticket.escalated",
  "sla.warning_50",
  "sla.warning_80",
  "sla.breached",
  "procurement.submitted",
  "procurement.approved",
  "procurement.rejected",
  "procurement.delivered",
  "attachment.quarantined",
]);

export type NotificationPrefRow = {
  eventType: NotificationEventType;
  emailEnabled: boolean;
  smsEnabled: boolean;
};

export async function listMyNotificationPreferences(): Promise<
  NotificationPrefRow[]
> {
  const user = await requireSessionUser();
  const rows = await db
    .select({
      eventType: notificationPreferences.eventType,
      emailEnabled: notificationPreferences.emailEnabled,
      smsEnabled: notificationPreferences.smsEnabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.id));

  const map = new Map<NotificationEventType, NotificationPrefRow>();
  for (const r of rows) {
    if (KNOWN_EVENT_TYPES.has(r.eventType as NotificationEventType)) {
      map.set(r.eventType as NotificationEventType, {
        eventType: r.eventType as NotificationEventType,
        emailEnabled: r.emailEnabled,
        smsEnabled: r.smsEnabled,
      });
    }
  }
  // Fill in defaults (email + SMS both on) for events the user has
  // never touched, so the UI renders the full grid.
  const out: NotificationPrefRow[] = [];
  for (const t of KNOWN_EVENT_TYPES) {
    out.push(
      map.get(t) ?? { eventType: t, emailEnabled: true, smsEnabled: true },
    );
  }
  return out;
}

export async function updateNotificationPreference(input: {
  eventType: string;
  channel: "email" | "sms";
  enabled: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!KNOWN_EVENT_TYPES.has(input.eventType as NotificationEventType)) {
    return { ok: false, error: "Unknown event type" };
  }
  if (input.channel !== "email" && input.channel !== "sms") {
    return { ok: false, error: "Unknown channel" };
  }
  const user = await requireSessionUser();

  const setValues =
    input.channel === "email"
      ? { emailEnabled: input.enabled }
      : { smsEnabled: input.enabled };

  await db
    .insert(notificationPreferences)
    .values({
      userId: user.id,
      eventType: input.eventType,
      emailEnabled:
        input.channel === "email" ? input.enabled : true,
      smsEnabled: input.channel === "sms" ? input.enabled : true,
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.eventType,
      ],
      set: setValues,
    });

  await audit({
    actorId: user.id,
    action: "user.update_notification_preference",
    targetType: "notification_preference",
    targetId: `${user.id}:${input.eventType}`,
    after: { channel: input.channel, enabled: input.enabled },
  });

  revalidatePath("/admin/profile");
  return { ok: true };
}
