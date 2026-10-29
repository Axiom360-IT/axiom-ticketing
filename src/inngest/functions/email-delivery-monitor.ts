import { cron } from "inngest";
import { withAutomationRun } from "@/lib/automations/runs";
import {
  BACKFILL_WINDOW,
  hasSyncedBefore,
  ROUTINE_WINDOW,
  syncDeliveryIssues,
} from "@/lib/email/delivery-monitor";
import { inngest } from "../client";

// Finds customers who are not receiving our email.
//
// Resend reports a send to a suppressed address as a SUCCESS — the call
// returns an id and no error — and only its own delivery log says "suppressed".
// So for as long as this system has existed, an address could be blocked for
// weeks while every ticket page said the reply had been sent. This reads that
// log back every ten minutes and records who is affected, so the ticket page
// and the user's profile can say so.
//
// Ten minutes because that is the point of the exercise: the failure it
// replaces was noticed by the CUSTOMER, a day later, and mentioned to a
// colleague. It reads a short recent window; the first ever run reads two
// weeks, so a problem that predates this job is found on day one instead of
// waiting for the next send to expose it.
export const emailDeliveryMonitor = inngest.createFunction(
  {
    id: "email-delivery-monitor",
    triggers: cron("*/10 * * * *"),
  },
  async () =>
    withAutomationRun("email-delivery-monitor", async () => {
      const backfill = !(await hasSyncedBefore());
      const result = await syncDeliveryIssues(
        backfill ? BACKFILL_WINDOW : ROUTINE_WINDOW,
      );
      // `{ skipped }` is passed through so the run is recorded as "nothing to
      // do" (no API key) rather than as a success.
      return "skipped" in result
        ? result
        : { ...result, mode: backfill ? "backfill" : "routine" };
    }),
);
