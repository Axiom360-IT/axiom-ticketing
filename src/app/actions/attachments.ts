"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, isStrictCustomer } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { requireSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { attachments } from "@/lib/db/schema/attachments";
import { messages } from "@/lib/db/schema/messages";
import {
  downloadDispositionFor,
  isAllowedMimeType,
  MAX_FILE_BYTES,
  sanitizeFilename,
} from "@/lib/storage/mime";
import { matchesMagicBytes } from "@/lib/storage/magic-bytes";
import {
  deleteObject,
  fetchObjectPrefix,
  getSignedDownloadUrl,
} from "@/lib/storage/signed-urls";
import {
  attachmentStorageKey,
  presignUploadUrl,
} from "@/lib/storage/upload";
import { inngest } from "@/inngest/client";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { loadTicketScope } from "@/lib/tickets/load";

// ── generateUploadUrl ───────────────────────────────────────────────

const uploadInputSchema = z.object({
  ticketId: z.string().uuid(),
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
});

export type GenerateUploadUrlInput = z.infer<typeof uploadInputSchema>;

export type GenerateUploadUrlResult =
  | {
      ok: true;
      attachmentId: string;
      uploadUrl: string;
      storageKey: string;
      sanitizedFilename: string;
    }
  | { ok: false; error: string };

export async function generateUploadUrl(
  input: GenerateUploadUrlInput,
): Promise<GenerateUploadUrlResult> {
  const parsed = uploadInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid upload request",
    };
  }
  const { ticketId, fileName, mimeType, sizeBytes } = parsed.data;

  if (!isAllowedMimeType(mimeType)) {
    return { ok: false, error: "File type not allowed." };
  }

  const user = await requireSessionUser();
  const ticket = await loadTicketScope(ticketId);
  if (!ticket) return { ok: false, error: "Ticket not found." };

  if (
    !(await can(
      user,
      "tickets.reply",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  const sanitized = sanitizeFilename(fileName);

  const [agent] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  // Insert with no message_id yet — the reply Server Action links the
  // attachment to its message after the reply is created. Orphaned rows
  // with upload_confirmed_at IS NULL after 24h are cleaned by the
  // cleanup-failed-uploads Inngest cron (M21).
  const [row] = await db
    .insert(attachments)
    .values({
      ticketId,
      uploadedById: user.id,
      uploadedByEmail: agent?.email ?? "unknown",
      fileName: sanitized,
      originalFileName: fileName,
      storageKey: "", // filled in below once we know the attachment ID
      mimeType: mimeType.toLowerCase(),
      sizeBytes,
      scanStatus: "pending",
    })
    .returning({ id: attachments.id });

  const storageKey = attachmentStorageKey(ticketId, row.id, sanitized);

  await db
    .update(attachments)
    .set({ storageKey })
    .where(eq(attachments.id, row.id));

  let uploadUrl: string;
  try {
    uploadUrl = await presignUploadUrl(storageKey, mimeType, sizeBytes);
  } catch (err) {
    // Tear down the row if presigning failed — otherwise we leave a
    // stub the cleanup cron will eventually catch.
    await db.delete(attachments).where(eq(attachments.id, row.id));
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not prepare upload",
    };
  }

  return {
    ok: true,
    attachmentId: row.id,
    uploadUrl,
    storageKey,
    sanitizedFilename: sanitized,
  };
}

// ── confirmUpload ───────────────────────────────────────────────────

const confirmInputSchema = z.object({
  attachmentId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
});

export type ConfirmUploadInput = z.infer<typeof confirmInputSchema>;
export type ConfirmUploadResult =
  | { ok: true; status: "clean" | "pending" }
  | { ok: false; error: string; status?: "quarantined" };

export async function confirmUpload(
  input: ConfirmUploadInput,
): Promise<ConfirmUploadResult> {
  const parsed = confirmInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid confirm request",
    };
  }
  const { attachmentId, messageId } = parsed.data;

  const user = await requireSessionUser();
  const [att] = await db
    .select({
      id: attachments.id,
      ticketId: attachments.ticketId,
      messageId: attachments.messageId,
      uploadedById: attachments.uploadedById,
      storageKey: attachments.storageKey,
      mimeType: attachments.mimeType,
      uploadConfirmedAt: attachments.uploadConfirmedAt,
      scanStatus: attachments.scanStatus,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  if (!att) return { ok: false, error: "Attachment not found." };

  // Only the uploader (or a privileged user with reply on the ticket) can
  // confirm. We check ticket-level reply permission to keep this simple.
  const ticket = await loadTicketScope(att.ticketId);
  if (!ticket) return { ok: false, error: "Ticket not found." };
  if (
    !(await can(
      user,
      "tickets.reply",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  // Idempotent: if already confirmed and clean, no-op.
  if (att.uploadConfirmedAt && att.scanStatus !== "pending") {
    return { ok: true, status: att.scanStatus as "clean" };
  }

  let prefix: Uint8Array;
  try {
    prefix = await fetchObjectPrefix(att.storageKey);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not read upload from R2",
    };
  }

  if (!matchesMagicBytes(att.mimeType, prefix)) {
    // Quarantine: delete object, mark row.
    try {
      await deleteObject(att.storageKey);
    } catch (err) {
      console.error("[confirmUpload] R2 delete failed:", err);
    }
    await db
      .update(attachments)
      .set({
        scanStatus: "quarantined",
        scanCompletedAt: new Date(),
      })
      .where(eq(attachments.id, attachmentId));
    await audit({
      actorId: user.id,
      action: "attachment.quarantine",
      targetType: "attachment",
      targetId: attachmentId,
      after: { reason: "magic-byte-mismatch", mimeType: att.mimeType },
    });
    return {
      ok: false,
      error: "File contents don't match the declared type.",
      status: "quarantined",
    };
  }

  await db
    .update(attachments)
    .set({
      uploadConfirmedAt: new Date(),
      messageId: messageId ?? att.messageId,
    })
    .where(eq(attachments.id, attachmentId));

  // Hand off to scan-attachment for ClamAV (currently a stub that marks
  // scan_status=clean — real scanner lands in M18).
  await inngest.send({
    name: "attachment/uploaded",
    data: { attachmentId },
  });

  await audit({
    actorId: user.id,
    action: "attachment.confirm",
    targetType: "attachment",
    targetId: attachmentId,
  });

  return { ok: true, status: "pending" };
}

// ── linkAttachmentsToMessage ────────────────────────────────────────
//
// Called after a reply / internal-note inserts its message, so the
// attachments uploaded with the reply get associated. Permits only
// the original uploader to attach to a message.

const linkInputSchema = z.object({
  messageId: z.string().uuid(),
  attachmentIds: z.array(z.string().uuid()).min(1).max(5),
});

export async function linkAttachmentsToMessage(
  messageId: string,
  attachmentIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = linkInputSchema.safeParse({ messageId, attachmentIds });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid link request",
    };
  }
  const user = await requireSessionUser();

  for (const id of parsed.data.attachmentIds) {
    await db
      .update(attachments)
      .set({ messageId: parsed.data.messageId })
      .where(
        and(
          eq(attachments.id, id),
          eq(attachments.uploadedById, user.id),
          isNull(attachments.messageId),
        ),
      );
  }
  return { ok: true };
}

// ── getDownloadUrl ──────────────────────────────────────────────────

export async function getDownloadUrl(
  attachmentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) {
    return { ok: false, error: "Invalid attachment id." };
  }
  const user = await requireSessionUser();
  const [att] = await db
    .select({
      id: attachments.id,
      ticketId: attachments.ticketId,
      messageId: attachments.messageId,
      storageKey: attachments.storageKey,
      mimeType: attachments.mimeType,
      fileName: attachments.fileName,
      scanStatus: attachments.scanStatus,
      uploadConfirmedAt: attachments.uploadConfirmedAt,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  if (!att) return { ok: false, error: "Attachment not found." };

  const ticket = await loadTicketScope(att.ticketId);
  if (!ticket) throw new NotFoundError();
  if (
    !(await can(
      user,
      "tickets.view",
      { type: "ticket", ticket },
      productionContext,
    ))
  ) {
    throw new ForbiddenError();
  }

  // Defense in depth: a Customer holds tickets.view on their own ticket, so the
  // permission gate alone would let them download internal-note attachments
  // whose IDs they happen to know. Block at the message-visibility seam.
  if (att.messageId && isStrictCustomer(user)) {
    const [msg] = await db
      .select({ isInternalNote: messages.isInternalNote })
      .from(messages)
      .where(eq(messages.id, att.messageId))
      .limit(1);
    if (msg?.isInternalNote) {
      throw new ForbiddenError();
    }
  }

  if (att.scanStatus === "quarantined") {
    return { ok: false, error: "This attachment has been quarantined." };
  }
  if (!att.uploadConfirmedAt) {
    return { ok: false, error: "Upload is still being processed." };
  }

  const url = await getSignedDownloadUrl(att.storageKey, {
    disposition: downloadDispositionFor(att.mimeType),
    filename: att.fileName,
  });
  return { ok: true, url };
}
