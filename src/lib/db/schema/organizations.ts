import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// ── Organizations registry (Meeting-2, CR-06) ─────────────────────────
//
// Every customer is a company, never a personal account. Organizations are
// fed into the system with their contract details so the team knows who is
// requesting support, the ticket number can carry an org abbreviation, and
// Monthly-Plan work can be deducted from a running balance of included hours.
//
// Hours are stored as integer MINUTES (not fractional hours) so the
// Monthly-Plan deduction — which subtracts a work-log's `minutes` — is exact
// and never drifts. The UI presents minutes as hours (minutes / 60).
// ──────────────────────────────────────────────────────────────────────

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    // Short code used as the ticket-number prefix (e.g. "KI" for Kingsmill).
    // Upper-case alphanumerics, 2–5 chars. Uniqueness lets a ticket number
    // imply its organization at a glance.
    abbreviation: text("abbreviation").notNull().unique(),
    // Monthly-plan flag + contract balance. When `isMonthlyPlan` is true the
    // included/remaining minutes describe how much labour the contract covers.
    isMonthlyPlan: boolean("is_monthly_plan").notNull().default(false),
    monthlyMinutesIncluded: integer("monthly_minutes_included"),
    monthlyMinutesBalance: integer("monthly_minutes_balance"),
    contractNotes: text("contract_notes"),
    isActive: boolean("is_active").notNull().default(true),
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
    index("organizations_name_idx").on(t.name),
    index("organizations_abbreviation_idx").on(t.abbreviation),
    index("organizations_is_active_idx").on(t.isActive),
    // Guard the abbreviation shape at the DB layer so a missed app-level
    // validation can't poison the ticket-number prefix.
    check(
      "organizations_abbreviation_format_check",
      sql`${t.abbreviation} ~ '^[A-Z0-9]{2,5}$'`,
    ),
  ],
);
