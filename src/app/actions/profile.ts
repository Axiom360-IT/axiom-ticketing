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
import { matchesMagicBytes } from "@/lib/storage/magic-bytes";
import {
  deleteObject,
  fetchObjectPrefix,
  objectExists,
} from "@/lib/storage/signed-urls";
import {
  avatarStorageKey,
  presignUploadUrl,
} from "@/lib/storage/upload";
import type { NotificationEventType } from "@/inngest/client";

// ── Avatar constants (module-private per Next.js 16 strict "use server") ──
const AVATAR_ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
const MIME_TO_EXT: Record<(typeof AVATAR_ALLOWED_MIMES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

// ── Account info ─────────────────────────────────────────────────

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  language: z.string().trim().min(2).max(10),
  // Optional E.164 phone — accepts empty string (cleared) or a valid
  // number. Stored as null when empty. The dispatch SMS leg gates on
  // `users.phone` being truthy, so clearing it disables SMS for the
  // user without touching their notification preferences.
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(
      /^(\+?[1-9]\d{1,14})?$/,
      "Phone must be in E.164 format (e.g. +14165550123)",
    )
    .optional(),
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

  // Empty-string phone → null in DB (no phone configured).
  const phoneValue =
    parsed.data.phone !== undefined
      ? parsed.data.phone.length > 0
        ? parsed.data.phone
        : null
      : undefined;

  await db
    .update(users)
    .set({
      name: parsed.data.name,
      language: parsed.data.language,
      ...(phoneValue !== undefined ? { phone: phoneValue } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await audit({
    actorId: user.id,
    action: "user.update_profile",
    targetType: "user",
    targetId: user.id,
    after: {
      name: parsed.data.name,
      language: parsed.data.language,
      ...(phoneValue !== undefined ? { phone: phoneValue } : {}),
    },
  });

  revalidatePath("/admin/profile");
  revalidatePath("/portal/profile");
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
  revalidatePath("/portal/profile");
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
  revalidatePath("/portal/profile");
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
  revalidatePath("/portal/profile");
  return { ok: true };
}

// ── Avatar upload / removal ──────────────────────────────────────
//
// Two-step flow (same shape as ticket attachments):
//   1. client calls `requestAvatarUpload` → server returns a presigned
//      PUT URL valid for 5 minutes.
//   2. client PUTs the bytes directly to R2 — Next.js doesn't carry
//      the file payload.
//   3. client calls `confirmAvatarUpload` → server HEAD-checks the
//      object exists, reads the magic-byte prefix to verify the file
//      is actually an image of the declared MIME, then updates
//      `users.image`. The previous avatar object is removed.
//
// Magic-byte verification is the canonical defence against `.exe`
// renamed to `.png` (ARCHITECTURE §11.6).

const requestAvatarUploadSchema = z.object({
  mimeType: z.enum(AVATAR_ALLOWED_MIMES),
  sizeBytes: z.number().int().positive().max(AVATAR_MAX_BYTES),
});

type RequestAvatarUploadResult =
  | { ok: true; uploadUrl: string; storageKey: string }
  | { ok: false; error: string };

export async function requestAvatarUpload(input: {
  mimeType: string;
  sizeBytes: number;
}): Promise<RequestAvatarUploadResult> {
  const parsed = requestAvatarUploadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid avatar file",
    };
  }
  const user = await requireSessionUser();

  const ext = MIME_TO_EXT[parsed.data.mimeType];
  const storageKey = avatarStorageKey(user.id, ext);
  const uploadUrl = await presignUploadUrl(
    storageKey,
    parsed.data.mimeType,
    parsed.data.sizeBytes,
  );

  return { ok: true, uploadUrl, storageKey };
}

const confirmAvatarUploadSchema = z.object({
  storageKey: z.string().trim().min(1).max(500),
});

type ConfirmAvatarUploadResult =
  | { ok: true }
  | { ok: false; error: string };

export async function confirmAvatarUpload(input: {
  storageKey: string;
}): Promise<ConfirmAvatarUploadResult> {
  const parsed = confirmAvatarUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid upload reference." };
  }
  const user = await requireSessionUser();
  const { storageKey } = parsed.data;

  // Defense-in-depth: the key must live under this user's avatar prefix.
  // A client that calls confirm with someone else's key gets refused
  // even though `presignUploadUrl` was never given that key for them.
  if (!storageKey.includes(`/avatars/${user.id}/`)) {
    return { ok: false, error: "Avatar reference does not belong to you." };
  }

  if (!(await objectExists(storageKey))) {
    return { ok: false, error: "Upload was not completed. Please try again." };
  }

  // Verify magic bytes match an allowed image type. The declared MIME at
  // presign time isn't trusted — the client could have lied.
  const prefix = await fetchObjectPrefix(storageKey);
  const matchedMime = AVATAR_ALLOWED_MIMES.find((m) =>
    matchesMagicBytes(m, prefix),
  );
  if (!matchedMime) {
    await deleteObject(storageKey).catch(() => undefined);
    return {
      ok: false,
      error:
        "File doesn't appear to be a valid image. Use PNG, JPEG, GIF, or WEBP.",
    };
  }

  // Capture the prior avatar so we can clean it up post-update.
  const [before] = await db
    .select({ image: users.image })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  await db
    .update(users)
    .set({ image: storageKey, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await audit({
    actorId: user.id,
    action: "user.update_avatar",
    targetType: "user",
    targetId: user.id,
    after: { storageKey },
  });

  // Best-effort cleanup. Failure just leaks a few KB in R2 — not a
  // correctness issue.
  if (before?.image && before.image !== storageKey) {
    await deleteObject(before.image).catch((err) =>
      console.error("[confirmAvatarUpload] old avatar cleanup failed:", err),
    );
  }

  revalidatePath("/admin/profile");
  revalidatePath("/portal/profile");
  return { ok: true };
}

type RemoveAvatarResult = { ok: true } | { ok: false; error: string };

export async function removeAvatar(): Promise<RemoveAvatarResult> {
  const user = await requireSessionUser();

  const [before] = await db
    .select({ image: users.image })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!before?.image) return { ok: true };

  await db
    .update(users)
    .set({ image: null, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await audit({
    actorId: user.id,
    action: "user.remove_avatar",
    targetType: "user",
    targetId: user.id,
    before: { storageKey: before.image },
  });

  await deleteObject(before.image).catch((err) =>
    console.error("[removeAvatar] cleanup failed:", err),
  );

  revalidatePath("/admin/profile");
  revalidatePath("/portal/profile");
  return { ok: true };
}
