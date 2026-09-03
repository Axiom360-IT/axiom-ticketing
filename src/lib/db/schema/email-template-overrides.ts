import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// ── Admin-editable email copy ─────────────────────────────────────────
//
// Every outbound email's text already lives as named i18n keys under
// `emails.<templateKey>` in src/messages/<locale>.json. This table stores
// SPARSE per-field overrides on top of that: one row per field an admin has
// actually reworded. No row = the compiled-in default text is used, so the
// app works identically on a fresh database and "Reset to default" is just a
// DELETE. Only plain-text fields are overridable — keys rendered as rich text
// (embedded links/markup) are excluded at the catalog level, so an override
// can never break an email's markup.
// ──────────────────────────────────────────────────────────────────────

export const emailTemplateOverrides = pgTable(
  "email_template_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Namespace suffix under `emails.` — e.g. "ticketCreated", "shared".
    templateKey: text("template_key").notNull(),
    locale: text("locale").notNull().default("en"),
    // Message key within that namespace — e.g. "subject", "body", "greeting".
    fieldKey: text("field_key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedById: uuid("updated_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("email_template_overrides_key_idx").on(
      t.templateKey,
      t.locale,
      t.fieldKey,
    ),
    index("email_template_overrides_template_idx").on(t.templateKey, t.locale),
  ],
);
