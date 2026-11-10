import { eventType } from "inngest";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema/notifications";
import {
  loadPlanContext,
  resolveRecipients,
} from "@/lib/notifications/deliver";
import { planDelivery } from "@/lib/notifications/plan";
import { inngest, type NotificationDispatchPayload } from "../client";

// FALLBACK dispatcher. Producers no longer emit `notification/dispatch` as the
// normal path: `emitNotification` (lib/notifications/deliver.ts) sends the bell,
// email and SMS in-process, so notifications do not depend on Inngest — which
// is metered, and on 2026-11-08 stopped running functions when the Hobby
// allowance ran out. This function only runs when a producer could not even
// plan the delivery (e.g. a database hiccup) and handed the event over, or for
// events that were already queued. It makes the same decisions as the direct
// path because both call `planDelivery`.
//
// Email/SMS legs go out as batched child events (handled by
// send-email-notification / send-sms-notification, each independently
// retried); the bell rows are one bulk insert. One step per channel, not per
// recipient, because Inngest bills every step as an execution.

export const dispatchNotification = inngest.createFunction(
  {
    id: "dispatch-notification",
    triggers: eventType("notification/dispatch"),
  },
  async ({ event, step }) => {
    const data = event.data as NotificationDispatchPayload;

    const recipients = await step.run("resolve-recipients", () =>
      resolveRecipients(data),
    );
    if (recipients.length === 0) return { recipients: 0, dispatched: 0 };

    const ctx = await step.run("load-preferences", () =>
      loadPlanContext(data, recipients),
    );

    const plan = planDelivery({
      data,
      recipients,
      preferences: ctx.preferences,
      customerIds: new Set(ctx.customerIds),
      customerSmsEnabled: ctx.customerSmsEnabled,
      orgAllowance: ctx.orgAllowance,
    });

    if (plan.inApp.length > 0) {
      await step.run("insert-in-app", async () => {
        await db.insert(notifications).values(plan.inApp);
      });
    }

    const childEvents = [
      ...plan.emails.map((d) => ({ name: "notification/email" as const, data: d })),
      ...plan.sms.map((d) => ({ name: "notification/sms" as const, data: d })),
    ];
    const BATCH = 100;
    for (let i = 0; i < childEvents.length; i += BATCH) {
      await step.sendEvent(
        `fan-out-${i / BATCH}`,
        childEvents.slice(i, i + BATCH),
      );
    }

    return { recipients: recipients.length, dispatched: plan.dispatched };
  },
);
