import { boolean, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

// ── Per-organization notification mutes ───────────────────────────────
//
// An admin can switch off, for ONE organization, a given notification on a
// given channel — e.g. "don't email this client's people when a technician is
// assigned", or "don't alert staff when this client's SLA hits 50%".
//
// A row only ever SUBTRACTS. Every channel defaults to true (allowed), and a
// missing row means "everything allowed", so existing organizations behave
// exactly as before. A person's own `notification_preferences` still apply on
// top: an org switch can silence a notification but never force one on.
//
// Which organization a notification belongs to is the organization of the
// ticket it is about, so the same event type covers both audiences:
//   customer-facing types (ticket.agent_replied, …) → that org's customers
//   staff-facing types    (ticket.assigned, sla.*, …) → staff, about that org's tickets
// Rows are kept sparse: a row whose three channels are all true is deleted.
// ──────────────────────────────────────────────────────────────────────

export const organizationNotificationSettings = pgTable(
  "organization_notification_settings",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    smsEnabled: boolean("sms_enabled").notNull().default(true),
    inAppEnabled: boolean("in_app_enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.eventType] })],
);
