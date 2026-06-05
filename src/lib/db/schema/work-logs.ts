import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { tickets } from "./tickets";

// ── Work log (Meeting-2, CR-12/15/19) ─────────────────────────────────
//
// A technician records each piece of work performed on a ticket: a free-text
// description, how long it took (integer minutes — covers hours and minutes),
// and whether it was on-site or remote. The system auto-timestamps each entry
// via `createdAt`. The summed minutes drive completion-time reporting and,
// when the ticket is billed as Monthly Plan, the deduction from the
// organization's monthly balance.
// ──────────────────────────────────────────────────────────────────────

export const workLogs = pgTable(
  "work_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "restrict" }),
    // The technician who performed the work (kept for history even if the
    // user is later removed).
    technicianId: uuid("technician_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Denormalized author-name snapshot captured at insert time, so a removed
    // or hard-deleted technician's entries stay attributable (read-only) after
    // technician_id is nulled — e.g. after reassignment or merge-removal.
    technicianName: text("technician_name"),
    description: text("description").notNull(),
    // Duration in minutes (e.g. 90 = 1h30m). Always > 0 (CHECK below).
    minutes: integer("minutes").notNull(),
    // On-site vs remote — selected by the technician per entry.
    serviceType: text("service_type").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("work_logs_ticket_id_idx").on(t.ticketId),
    index("work_logs_technician_id_idx").on(t.technicianId),
    index("work_logs_created_at_idx").on(t.createdAt.desc()),
    check("work_logs_minutes_check", sql`${t.minutes} > 0`),
    check(
      "work_logs_service_type_check",
      sql`${t.serviceType} IN ('onsite','remote')`,
    ),
  ],
);
