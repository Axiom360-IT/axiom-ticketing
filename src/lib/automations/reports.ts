import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { scheduledReports } from "@/lib/db/schema/automations";
import { isExportFormat, type ExportFormat } from "@/lib/export/dataset";
import { renderExport } from "@/lib/export/respond";
import { sendEmail } from "@/lib/email/send";
import { buildReportDataset } from "@/lib/reports/dataset";
import {
  loadCsatStats,
  loadProcurementSpend,
  loadTicketHealth,
  type ReportRange,
} from "@/lib/reports/queries";

// ── Scheduled reports: what to build, who gets it ─────────────────────

/**
 * The reports a schedule can be built from.
 *
 * Only one entry today, and that is deliberate rather than unfinished: the
 * management report already carries ticket health, CSAT and procurement spend
 * in one document, which is what someone asking for "the daily report" means.
 * Splitting it into three schedules would mean three emails at 19:00.
 *
 * Adding a kind is a two-line change here plus a CHECK-free text column, so
 * the next one does not need a migration.
 */
export const REPORT_KINDS = ["management"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export function isReportKind(v: unknown): v is ReportKind {
  return typeof v === "string" && (REPORT_KINDS as readonly string[]).includes(v);
}

export type ScheduledReportRow = typeof scheduledReports.$inferSelect;

/**
 * The subset a run actually needs — no Date fields.
 *
 * Deliberate: the dispatcher loads schedules inside `step.run`, and Inngest
 * memoizes step results as JSON, so `createdAt` comes back a string on a
 * replay. Narrowing here means the compiler enforces that none of those
 * round-tripped fields is ever read as a Date.
 */
export type ReportToRun = Pick<
  ScheduledReportRow,
  | "id"
  | "name"
  | "report"
  | "rangeDays"
  | "format"
  | "recipientUserIds"
  | "recipientRoles"
  | "recipientEmails"
>;

/** Resolve a range ending now and starting `rangeDays` ago. */
export function rangeForDays(rangeDays: number, now: Date): ReportRange {
  return {
    from: new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000),
    to: now,
  };
}

/**
 * Everyone who should receive a given report, deduped and lower-cased.
 *
 * Three independent sources, unioned:
 *   • named accounts  — a specific person
 *   • roles           — "whoever is IT Director". Survives a handover, which
 *                       a hardcoded address does not; this is the one to
 *                       prefer and the UI says so.
 *   • literal emails  — an accountant or client contact with no account
 *
 * Inactive accounts are dropped: a deactivated user must stop receiving
 * company reporting the moment they are deactivated, not whenever someone
 * remembers to edit the schedule.
 */
export async function resolveRecipients(
  report: Pick<
    ScheduledReportRow,
    "recipientUserIds" | "recipientRoles" | "recipientEmails"
  >,
): Promise<string[]> {
  const out = new Set<string>();

  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const userIds = asStrings(report.recipientUserIds);
  const roleNames = asStrings(report.recipientRoles);
  const literal = asStrings(report.recipientEmails);

  for (const e of literal) {
    const t = e.trim().toLowerCase();
    if (t) out.add(t);
  }

  if (userIds.length > 0) {
    const rows = await db
      .select({ email: users.email, isActive: users.isActive })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const r of rows) {
      if (r.isActive) out.add(r.email.toLowerCase());
    }
  }

  if (roleNames.length > 0) {
    const rows = await db
      .selectDistinct({ email: users.email, isActive: users.isActive })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(inArray(roles.name, roleNames));
    for (const r of rows) {
      if (r.isActive) out.add(r.email.toLowerCase());
    }
  }

  return [...out];
}

export type ReportFailure = { email: string; reason: string };

export type ReportSendOutcome = {
  recipients: number;
  delivered: number;
  /** Why each one failed, not just who. "Failed: a@b, c@d" tells the operator
   *  nothing they can act on; Resend's rejection message does. */
  failed: ReportFailure[];
  filename: string;
  skipped?: "no-recipients";
};

/**
 * Build one scheduled report and mail it.
 *
 * Built ONCE and sent to each recipient, rather than rebuilt per person — the
 * document is identical for everyone, and a report with twelve recipients
 * should not run twelve copies of the same aggregate queries.
 *
 * Per-recipient sends are individually guarded: one bad address must not cost
 * the other eleven their report. The failures come back for the audit entry.
 */
export async function runScheduledReport(args: {
  report: ReportToRun;
  now: Date;
  /** Local date the run is FOR, used in the subject so a late send is honest
   *  about which day it covers. */
  forDate: string;
}): Promise<ReportSendOutcome> {
  const { report, now, forDate } = args;

  const recipients = await resolveRecipients(report);
  const format: ExportFormat = isExportFormat(report.format)
    ? report.format
    : "xlsx";

  if (recipients.length === 0) {
    // Nothing to send, but still worth building nothing and saying why: a
    // schedule whose only recipient was deactivated is a silent failure
    // otherwise.
    return {
      recipients: 0,
      delivered: 0,
      failed: [],
      filename: "",
      skipped: "no-recipients",
    };
  }

  const range = rangeForDays(report.rangeDays, now);
  const [tickets, procurement, csat] = await Promise.all([
    loadTicketHealth(range),
    loadProcurementSpend(range),
    loadCsatStats(range),
  ]);

  const dataset = buildReportDataset(
    tickets,
    procurement,
    csat,
    // Attributed to the schedule, not a person — nobody pressed a button.
    `Scheduled: ${report.name}`,
    range,
  );

  const rendered = await renderExport(dataset, format, "report", now);

  const failed: ReportFailure[] = [];
  let delivered = 0;
  for (const to of recipients) {
    try {
      await sendEmail({
        to,
        template: {
          template: "scheduled_report",
          data: {
            reportName: report.name,
            forDate,
            rangeDays: report.rangeDays,
            fileName: rendered.filename,
          },
        },
        attachments: [{ filename: rendered.filename, content: rendered.body }],
      });
      delivered++;
    } catch (err) {
      console.error(`[scheduled-report] send to ${to} failed:`, err);
      failed.push({
        email: to,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    recipients: recipients.length,
    delivered,
    failed,
    filename: rendered.filename,
  };
}
