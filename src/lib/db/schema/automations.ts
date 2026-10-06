import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// ── Automations: run history + user-created scheduled reports ─────────
//
// Seventeen background jobs already run on a schedule or an event. Until now
// their only trace was the Inngest dashboard, so "did the follow-up monitor
// fire last night?" was unanswerable from inside the app. `automation_runs`
// is that answer.
//
// `scheduled_reports` is the first automation a user can CREATE rather than
// just configure. Deliberately NOT one Inngest cron per report — that would
// need a code change and a deploy for every new schedule. One dispatcher runs
// every five minutes and decides what is due.

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Matches the Inngest function id, or `scheduled-report:<uuid>`. */
    automationId: text("automation_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** running → ok | skipped | error. `skipped` is a success: the job woke,
     *  found nothing to do (or is switched off), and said so. */
    status: text("status").notNull().default("running"),
    /** Whatever the job returned — counts, ids, the reason it skipped. */
    summary: jsonb("summary"),
    error: text("error"),
  },
  (t) => [
    check(
      "automation_runs_status_check",
      sql`${t.status} IN ('running','ok','skipped','error')`,
    ),
    // The page's only read pattern: newest runs for one automation.
    index("automation_runs_automation_started_idx").on(
      t.automationId,
      t.startedAt.desc(),
    ),
  ],
);

export const scheduledReports = pgTable(
  "scheduled_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** What the creator called it — shown in the list and the email subject. */
    name: text("name").notNull(),
    /** Which report to build. See REPORT_KINDS in lib/automations/reports.ts. */
    report: text("report").notNull(),
    /** How far back the report looks, in days. 1 = yesterday-to-now. */
    rangeDays: integer("range_days").notNull().default(1),
    format: text("format").notNull().default("xlsx"),
    /** Local wall-clock send time, in `business_hours.timezone`. */
    hour: integer("hour").notNull(),
    minute: integer("minute").notNull().default(0),
    /** Which days it runs, as ["Mon","Tue",…]. Same vocabulary as
     *  `business_hours.working_days`, so the two read alike. */
    weekdays: jsonb("weekdays")
      .notNull()
      .default(sql`'["Mon","Tue","Wed","Thu","Fri"]'::jsonb`),
    /** Recipients resolve from three independent sources, unioned and deduped:
     *  named accounts, everyone holding a role, and literal addresses. Roles
     *  matter most — "the IT Director" should keep working after a handover. */
    recipientUserIds: jsonb("recipient_user_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    recipientRoles: jsonb("recipient_roles").notNull().default(sql`'[]'::jsonb`),
    recipientEmails: jsonb("recipient_emails")
      .notNull()
      .default(sql`'[]'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    /** The local date (YYYY-MM-DD) this last sent for. The double-send guard:
     *  the dispatcher runs every five minutes, so without this a report due at
     *  19:00 would go out twelve times an hour. */
    lastRunOn: text("last_run_on"),
    lastStatus: text("last_status"),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("scheduled_reports_hour_check", sql`${t.hour} BETWEEN 0 AND 23`),
    check("scheduled_reports_minute_check", sql`${t.minute} BETWEEN 0 AND 59`),
    check(
      "scheduled_reports_format_check",
      sql`${t.format} IN ('xlsx','csv','pdf')`,
    ),
    check(
      "scheduled_reports_range_check",
      sql`${t.rangeDays} BETWEEN 1 AND 365`,
    ),
  ],
);
