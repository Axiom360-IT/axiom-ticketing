import { eq } from "drizzle-orm";
import { cron } from "inngest";
import { audit } from "@/lib/audit";
import { withAutomationRun } from "@/lib/automations/runs";
import { runScheduledReport } from "@/lib/automations/reports";
import { isReportDue, safeLocalMoment } from "@/lib/automations/schedule";
import { db } from "@/lib/db/client";
import { scheduledReports } from "@/lib/db/schema/automations";
import { getSetting } from "@/lib/settings";
import { inngest } from "../client";

// Every five minutes. The one job that drives every user-created schedule.
//
// Why a dispatcher instead of one Inngest cron per report: a cron expression
// lives in code and ships in a deploy. A report the IT Director creates at
// 16:05 and expects at 19:00 the same day cannot wait for a release. So this
// wakes often, asks `isReportDue` what should go out, and sends it.
//
// Five minutes is the resolution of the whole feature: a report set for 19:00
// goes out between 19:00 and 19:05. Tightening it means more wake-ups for the
// same work; the honest trade is stated in the UI rather than hidden.
//
// All eight sibling crons run in UTC and so does this one — the "19:00" is
// interpreted against `business_hours.timezone` inside `isReportDue`, not by
// the scheduler.

export const scheduledReportDispatcher = inngest.createFunction(
  {
    id: "scheduled-report-dispatcher",
    // Reports are rebuilt from scratch each run and the double-send guard is a
    // stored date, so a retry is safe — but it would re-send to everyone who
    // already received it in the same run, so keep retries low.
    retries: 1,
    triggers: cron("*/5 * * * *"),
  },
  async ({ step }) =>
    withAutomationRun("scheduled-report-dispatcher", async () => {
      const cfg = await step.run("load-config", async () => {
        const [enabled, timezone] = await Promise.all([
          getSetting<boolean>("scheduled_reports.enabled"),
          getSetting<string>("business_hours.timezone"),
        ]);
        return {
          enabled: typeof enabled === "boolean" ? enabled : true,
          timezone:
            typeof timezone === "string" && timezone.trim()
              ? timezone
              : "UTC",
        };
      });

      if (!cfg.enabled) return { skipped: "disabled" as const };

      const candidates = await step.run("load-schedules", async () =>
        db
          .select()
          .from(scheduledReports)
          .where(eq(scheduledReports.enabled, true)),
      );

      if (candidates.length === 0) {
        return { skipped: "no-schedules" as const };
      }

      // One instant for the whole batch, so two reports due at the same minute
      // can't disagree about what day it is.
      const now = new Date();
      const local = safeLocalMoment(now, cfg.timezone);

      const due = candidates.filter((r) => {
        const weekdays = Array.isArray(r.weekdays)
          ? (r.weekdays as unknown[]).filter(
              (w): w is string => typeof w === "string",
            )
          : [];
        return isReportDue(
          {
            hour: r.hour,
            minute: r.minute,
            weekdays,
            enabled: r.enabled,
            lastRunOn: r.lastRunOn,
          },
          local,
        ).due;
      });

      if (due.length === 0) {
        return {
          skipped: "nothing-due" as const,
          localTime: `${local.date} ${local.hour}:${String(local.minute).padStart(2, "0")}`,
          considered: candidates.length,
        };
      }

      const sent: Record<string, unknown>[] = [];

      for (const report of due) {
        // Claim the slot BEFORE sending. If the send throws half way through a
        // twelve-person list, the retry must not start the list again — the
        // recipients who already received it would get a second copy. Marking
        // first means a crashed run loses the remainder rather than duplicating
        // the delivered part, and `last_status` records that it was incomplete.
        await step.run(`claim-${report.id}`, async () => {
          await db
            .update(scheduledReports)
            .set({
              lastRunOn: local.date,
              lastStatus: "sending",
              updatedAt: new Date(),
            })
            .where(eq(scheduledReports.id, report.id));
        });

        const outcome = await step.run(`send-${report.id}`, async () => {
          try {
            const res = await runScheduledReport({
              report,
              now,
              forDate: local.date,
            });
            await db
              .update(scheduledReports)
              .set({
                lastStatus: res.skipped ?? (res.failed.length ? "partial" : "ok"),
                updatedAt: new Date(),
              })
              .where(eq(scheduledReports.id, report.id));
            return { id: report.id, name: report.name, ...res };
          } catch (err) {
            await db
              .update(scheduledReports)
              .set({ lastStatus: "error", updatedAt: new Date() })
              .where(eq(scheduledReports.id, report.id));
            console.error(
              `[scheduled-report] ${report.name} (${report.id}) failed:`,
              err,
            );
            return {
              id: report.id,
              name: report.name,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        });

        sent.push(outcome as Record<string, unknown>);

        await step.run(`audit-${report.id}`, async () => {
          await audit({
            actorId: null,
            action: "automation.scheduled_report_sent",
            targetType: "scheduled_report",
            targetId: report.id,
            after: outcome,
          });
        });
      }

      return { forDate: local.date, sent };
    }),
);
