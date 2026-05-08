import { eq } from "drizzle-orm";
import { eventType } from "inngest";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema/attachments";
import { inngest } from "../client";

// Stub for the malware scan path. Per ARCHITECTURE §12, ClamAV is "off
// by default" — we still flow every confirmed upload through this
// function so the wiring exists. M18 wires up the actual scanner.
//
// Until then: flip pending → clean and stamp scan_completed_at. If the
// file was already quarantined upstream (magic-byte mismatch in
// confirmUpload) we leave it alone.

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
      after: { result: "clean", scanner: "stub" },
    });

    return { status: "clean", attachmentId };
  },
);
