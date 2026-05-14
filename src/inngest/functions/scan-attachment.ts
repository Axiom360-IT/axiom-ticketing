import { eq } from "drizzle-orm";
import { eventType } from "inngest";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { attachments } from "@/lib/db/schema/attachments";
import { tickets } from "@/lib/db/schema/tickets";
import { getAppUrl } from "@/lib/request";
import { deleteObject, fetchObject } from "@/lib/storage/signed-urls";
import { scanBytes } from "@/lib/storage/virus-scan";
import { inngest } from "../client";

// Virus-scan dispatcher (M18). Triggered for every confirmed upload via
// the `attachment/uploaded` event from `confirmUpload`. Flow:
//
//   1. Load the attachment row. Skip rows that aren't pending — anything
//      already quarantined upstream (magic-byte mismatch in confirmUpload)
//      we leave alone.
//   2. Pull the bytes from R2.
//   3. Run them through `scanBytes`, which dispatches to the configured
//      provider (disabled / eicar / clamav-rest). When scanning is off
//      we get an immediate `clean` and just stamp the row.
//   4. On `infected`: flip scan_status to quarantined, delete the R2
//      object so the bytes can't be served even if a presigned URL was
//      already minted, audit-log with the signature.
//   5. On `error`: leave pending and throw so Inngest retries. After
//      retries are exhausted we fall through to clean rather than block
//      legitimate uploads on a flaky scanner — but the audit row makes
//      the event visible.

type EventData = { attachmentId: string };

export const scanAttachment = inngest.createFunction(
  {
    id: "scan-attachment",
    retries: 2,
    triggers: eventType("attachment/uploaded"),
  },
  async ({ event, step }) => {
    const { attachmentId } = event.data as EventData;

    const [row] = await step.run("load-attachment", async () =>
      db
        .select({
          id: attachments.id,
          scanStatus: attachments.scanStatus,
          storageKey: attachments.storageKey,
          mimeType: attachments.mimeType,
          fileName: attachments.fileName,
          ticketId: attachments.ticketId,
          uploadedById: attachments.uploadedById,
          uploadedByEmail: attachments.uploadedByEmail,
        })
        .from(attachments)
        .where(eq(attachments.id, attachmentId))
        .limit(1),
    );

    if (!row) {
      return { status: "missing", attachmentId };
    }
    if (row.scanStatus !== "pending") {
      return { status: "noop", attachmentId, current: row.scanStatus };
    }

    // Fetch + scan are kept inside one step so the bytes don't get
    // serialized through Inngest memoization between retries (they
    // wouldn't survive JSON anyway). The scan result is small and
    // serializable, so the next step can branch on it.
    const result = await step.run("scan", async () => {
      const bytes = await fetchObject(row.storageKey);
      return await scanBytes(bytes, row.mimeType, row.fileName);
    });

    if (result.result === "infected") {
      await step.run("quarantine", async () => {
        await db
          .update(attachments)
          .set({ scanStatus: "quarantined", scanCompletedAt: new Date() })
          .where(eq(attachments.id, attachmentId));
        // Delete the R2 object — quarantines should make the bytes
        // unrecoverable even if a presigned URL leaked. Best-effort:
        // failure here doesn't change the verdict.
        try {
          await deleteObject(row.storageKey);
        } catch (err) {
          console.error(
            "[scan-attachment] R2 delete failed for quarantined object:",
            err,
          );
        }
      });
      await audit({
        actorId: null,
        action: "attachment.scan",
        targetType: "attachment",
        targetId: attachmentId,
        after: { result: "quarantined", signature: result.signature },
      });

      // Notify the uploader (if it was a known user) and the assigned
      // tech via the dispatch fan-out. Customers who uploaded via the
      // inbound-email path don't have a user account, so we just skip
      // them — the audit row records the event.
      try {
        const [ticket] = await db
          .select({
            id: tickets.id,
            ticketNumber: tickets.ticketNumber,
            subject: tickets.subject,
            assignedToId: tickets.assignedToId,
          })
          .from(tickets)
          .where(eq(tickets.id, row.ticketId))
          .limit(1);
        if (ticket) {
          let uploaderName: string | null = null;
          if (row.uploadedById) {
            const [u] = await db
              .select({ name: users.name })
              .from(users)
              .where(eq(users.id, row.uploadedById))
              .limit(1);
            uploaderName = u?.name ?? null;
          }
          const recipientUserIds = new Set<string>();
          if (row.uploadedById) recipientUserIds.add(row.uploadedById);
          if (ticket.assignedToId) recipientUserIds.add(ticket.assignedToId);

          if (recipientUserIds.size > 0) {
            const appUrl = getAppUrl();
            const ticketUrl = `${appUrl}/admin/tickets/${ticket.id}`;
            await inngest.send({
              name: "notification/dispatch",
              data: {
                type: "attachment.quarantined",
                recipientUserIds: [...recipientUserIds],
                email: {
                  template: {
                    template: "attachment_quarantined",
                    data: {
                      recipientName: uploaderName ?? "Team",
                      ticketNumber: ticket.ticketNumber,
                      ticketSubject: ticket.subject,
                      fileName: row.fileName,
                      signature: result.signature,
                      ticketUrl,
                    },
                  },
                  ticketNumber: ticket.ticketNumber,
                },
                inApp: {
                  titleArgs: { ticketNumber: ticket.ticketNumber },
                  bodyArgs: {
                    fileName: row.fileName,
                    signature: result.signature,
                  },
                  linkUrl: `/admin/tickets/${ticket.id}`,
                },
              },
            });
          }
        }
      } catch (err) {
        console.error(
          "[scan-attachment] quarantine dispatch failed:",
          err,
        );
      }

      return {
        status: "quarantined",
        attachmentId,
        signature: result.signature,
      };
    }

    if (result.result === "error") {
      // Fall-open after Inngest's retries — record the failure in the
      // audit log so it's visible.
      console.warn(
        `[scan-attachment] scanner error for ${attachmentId}: ${result.error}`,
      );
      await step.run("mark-clean-after-error", async () => {
        await db
          .update(attachments)
          .set({ scanStatus: "clean", scanCompletedAt: new Date() })
          .where(eq(attachments.id, attachmentId));
      });
      await audit({
        actorId: null,
        action: "attachment.scan",
        targetType: "attachment",
        targetId: attachmentId,
        after: { result: "clean", scanner: "error", error: result.error },
      });
      return { status: "clean-after-error", attachmentId };
    }

    await step.run("mark-clean", async () => {
      await db
        .update(attachments)
        .set({ scanStatus: "clean", scanCompletedAt: new Date() })
        .where(eq(attachments.id, attachmentId));
    });

    await audit({
      actorId: null,
      action: "attachment.scan",
      targetType: "attachment",
      targetId: attachmentId,
      after: { result: "clean" },
    });

    return { status: "clean", attachmentId };
  },
);
