"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { BRANDING_LOGO_KEY } from "@/lib/branding/load";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema/settings";
import { ForbiddenError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { matchesMagicBytes } from "@/lib/storage/magic-bytes";
import {
  deleteObject,
  fetchObjectPrefix,
  objectExists,
} from "@/lib/storage/signed-urls";
import { logoStorageKey, presignUploadUrl } from "@/lib/storage/upload";

// Branding logo upload. Two-step (presign → PUT to R2 → confirm), same shape
// as the avatar flow. Gated by `settings.update` — the logo is a branding
// asset, so the permission gate + magic-byte verification is the control (no
// re-auth prompt mid-upload, unlike the text/colour settings).

const LOGO_ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
const MIME_TO_EXT: Record<(typeof LOGO_ALLOWED_MIMES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

async function requireBrandingAdmin() {
  const user = await requireSessionUser();
  if (
    !(await can(user, "settings.update", { type: "global" }, productionContext))
  ) {
    throw new ForbiddenError();
  }
  return user;
}

async function persistLogoKey(
  value: string | null,
  userId: string,
): Promise<void> {
  if (value === null) {
    await db.delete(settings).where(eq(settings.key, BRANDING_LOGO_KEY));
    return;
  }
  await db
    .insert(settings)
    .values({ key: BRANDING_LOGO_KEY, value, updatedById: userId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedById: userId, updatedAt: new Date() },
    });
}

const requestSchema = z.object({
  mimeType: z.enum(LOGO_ALLOWED_MIMES),
  sizeBytes: z.number().int().positive().max(LOGO_MAX_BYTES),
});

export async function requestLogoUpload(input: {
  mimeType: string;
  sizeBytes: number;
}): Promise<
  | { ok: true; uploadUrl: string; storageKey: string }
  | { ok: false; error: string }
> {
  await requireBrandingAdmin();
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid logo file",
    };
  }
  const ext = MIME_TO_EXT[parsed.data.mimeType];
  const storageKey = logoStorageKey(ext);
  const uploadUrl = await presignUploadUrl(
    storageKey,
    parsed.data.mimeType,
    parsed.data.sizeBytes,
  );
  return { ok: true, uploadUrl, storageKey };
}

const confirmSchema = z.object({
  storageKey: z.string().trim().min(1).max(500),
});

export async function confirmLogoUpload(input: {
  storageKey: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireBrandingAdmin();
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload reference." };
  const { storageKey } = parsed.data;

  // Defence-in-depth: only accept a key under the branding prefix.
  if (!storageKey.includes("/branding/")) {
    return { ok: false, error: "Logo reference is not valid." };
  }
  if (!(await objectExists(storageKey))) {
    return { ok: false, error: "Upload was not completed. Please try again." };
  }

  // The declared MIME isn't trusted — verify the actual bytes.
  const prefix = await fetchObjectPrefix(storageKey);
  const matched = LOGO_ALLOWED_MIMES.find((m) => matchesMagicBytes(m, prefix));
  if (!matched) {
    await deleteObject(storageKey).catch(() => undefined);
    return {
      ok: false,
      error: "File doesn't appear to be a valid image. Use PNG, JPEG, GIF, or WEBP.",
    };
  }

  const oldKey = await getSetting<string>(BRANDING_LOGO_KEY);
  await persistLogoKey(storageKey, user.id);

  await audit({
    actorId: user.id,
    action: "settings.update",
    targetType: "setting",
    targetId: BRANDING_LOGO_KEY,
    after: { logo: "set" },
  });

  if (typeof oldKey === "string" && oldKey.length > 0 && oldKey !== storageKey) {
    await deleteObject(oldKey).catch((err) =>
      console.error("[confirmLogoUpload] old logo cleanup failed:", err),
    );
  }

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function removeLogo(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const user = await requireBrandingAdmin();
  const oldKey = await getSetting<string>(BRANDING_LOGO_KEY);
  if (typeof oldKey !== "string" || oldKey.length === 0) return { ok: true };

  await persistLogoKey(null, user.id);
  await audit({
    actorId: user.id,
    action: "settings.update",
    targetType: "setting",
    targetId: BRANDING_LOGO_KEY,
    after: { logo: "removed" },
  });
  await deleteObject(oldKey).catch((err) =>
    console.error("[removeLogo] cleanup failed:", err),
  );

  revalidatePath("/admin/settings");
  return { ok: true };
}
