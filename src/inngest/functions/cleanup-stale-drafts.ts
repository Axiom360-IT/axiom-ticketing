import { and, eq, inArray, lt } from "drizzle-orm";
import { cron } from "inngest";
import { db } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema/attachments";
import { tickets } from "@/lib/db/schema/tickets";
import { deleteObject } from "@/lib/storage/signed-urls";
import { inngest } from "../client";

// Daily at 4:15am UTC. Removes ticket rows that were created as
// pre-submission drafts (`status='draft'`) but never promoted to
// `open`. Drafts exist only so customers can upload attachments before
// the ticket is real; abandoned drafts (user closed the tab, captcha
// failed, etc.) leak ticket numbers + R2 objects if we don't sweep them.
//
// Threshold is 24h — long enough that a slow user can still finish
// their submission, short enough that a leaked draft can't be exploited
// indefinitely as a free file host.

const STALE_DRAFT_MS = 24 * 60 * 60 * 1000;

export const cleanupStaleDrafts = inngest.createFunction(
  {
    id: "cleanup-stale-drafts",
    triggers: cron("15 4 * * *"),
  },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - STALE_DRAFT_MS);

    const stale = await step.run("find-stale-drafts", async () => {
      return db
        .select({ id: tickets.id, ticketNumber: tickets.ticketNumber })
        .from(tickets)
        .where(and(eq(tickets.status, "draft"), lt(tickets.createdAt, cutoff)));
    });

    if (stale.length === 0) {
      return { drafts: 0, attachments: 0 };
    }

    const draftIds = stale.map((t) => t.id);

    // Delete R2 objects for any attachments uploaded to these drafts
    // before we drop the rows (FK is ON DELETE RESTRICT — must clear
    // attachments first anyway).
    const result = await step.run("delete-attachments", async () => {
      const atts = await db
        .select({ id: attachments.id, storageKey: attachments.storageKey })
        .from(attachments)
        .where(inArray(attachments.ticketId, draftIds));

      for (const a of atts) {
        if (!a.storageKey) continue;
        try {
          await deleteObject(a.storageKey);
        } catch (err) {
          console.error(
            `[cleanup-stale-drafts] R2 delete failed for ${a.storageKey}:`,
            err,
          );
        }
      }

      if (atts.length > 0) {
        await db
          .delete(attachments)
          .where(
            inArray(
              attachments.id,
              atts.map((a) => a.id),
            ),
          );
      }
      return atts.length;
    });

    await step.run("delete-drafts", async () => {
      await db.delete(tickets).where(inArray(tickets.id, draftIds));
    });

    return { drafts: stale.length, attachments: result };
  },
);
