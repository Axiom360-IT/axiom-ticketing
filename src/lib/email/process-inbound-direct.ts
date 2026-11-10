import "server-only";
import { and, eq } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { processedWebhookEvents } from "@/lib/db/schema/webhooks";
import { inngest } from "@/inngest/client";
import {
  type EventData,
  runInboundEmail,
} from "@/inngest/functions/process-inbound-email";
import { createDirectStep, isSafeToReenqueue } from "./direct-step";

// Runs one inbound email through the full processing pipeline INSIDE the
// webhook's own process, with no dependency on Inngest being healthy.
//
// Why: Inngest is metered. On 2026-11-08 the Hobby allowance ran out and it
// kept accepting events while running none of them, so for two days every
// inbound email was received, logged, and never turned into a ticket. Ticket
// creation is the one thing that must not depend on a queue, so it now happens
// here, and Inngest is only the safety net.
//
// Outcomes, in order of preference:
//   1. Direct run succeeds                       -> done; Inngest is never involved.
//   2. It fails having written NOTHING           -> hand the whole email to Inngest.
//      (every step that ran was a read, so a replay cannot duplicate anything)
//   3. It fails having written something         -> do NOT replay (that could post a
//      duplicate message/ticket); keep the idempotency marker and leave an audit
//      record so the half-processed email is findable.
//   4. Case 2, but the fallback enqueue also fails -> release the idempotency
//      marker so a replay from Resend's dashboard is processed rather than
//      swallowed as a duplicate.
//
// Never throws: it runs after the webhook response has been sent, so there is
// nobody left to throw to.

const PROVIDER = "resend";
const EVENT_NAME = "email/inbound.received";

export async function processInboundDirect(data: EventData): Promise<void> {
  const { step, trace } = createDirectStep();
  try {
    const result = await runInboundEmail(data, step);
    console.info("[email/inbound] processed directly", {
      eventId: data.eventId,
      status: (result as { status?: string } | undefined)?.status,
    });
    return;
  } catch (err) {
    console.error("[email/inbound] direct processing failed", {
      eventId: data.eventId,
      failedStep: trace.failedStep,
      completedSteps: trace.completed,
      error: err instanceof Error ? err.message : String(err),
    });

    if (isSafeToReenqueue(trace)) {
      try {
        await inngest.send({ name: EVENT_NAME, data });
        console.warn(
          "[email/inbound] nothing was written; re-enqueued to Inngest",
          { eventId: data.eventId },
        );
        return;
      } catch (enqueueErr) {
        console.error(
          "[email/inbound] fallback enqueue failed; releasing idempotency marker so a Resend replay can retry",
          enqueueErr,
        );
        await db
          .delete(processedWebhookEvents)
          .where(
            and(
              eq(processedWebhookEvents.provider, PROVIDER),
              eq(processedWebhookEvents.eventId, data.eventId),
            ),
          )
          .catch(() => {});
        return;
      }
    }

    // Partially processed. Leave a trail; do not replay.
    try {
      await audit({
        actorId: null,
        action: "inbound_email.process_failed",
        targetType: "webhook_event",
        targetId: data.eventId,
        after: {
          from: data.payload.fromEmail ?? null,
          subject: data.payload.subject ?? null,
          failedStep: trace.failedStep,
          completedSteps: trace.completed,
          error: err instanceof Error ? err.message : String(err),
        },
        outcome: "error",
      });
    } catch (auditErr) {
      console.error("[email/inbound] could not audit failure", auditErr);
    }
  }
}
