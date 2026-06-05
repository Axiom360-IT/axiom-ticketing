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
import { organizations } from "./organizations";

// ── Organization trusted email contacts (req 5.2 follow-up) ───────────
//
// Individual external email addresses a moderator has marked as legitimate for
// an organization. Unlike `organization_domains` (whole-domain trust) this is
// per-address, so a single person on a free-mail address (e.g. a contractor's
// gmail) can be trusted without trusting their whole domain. An inbound reply
// whose sender is here for the ticket's org is auto-posted (not held), and the
// trust can be revoked later to moderate them again.
// ──────────────────────────────────────────────────────────────────────

export const organizationTrustedEmails = pgTable(
  "organization_trusted_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Lower-cased email address.
    email: text("email").notNull(),
    name: text("name"),
    addedById: uuid("added_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("org_trusted_emails_org_email_key").on(
      t.organizationId,
      t.email,
    ),
    index("org_trusted_emails_org_id_idx").on(t.organizationId),
  ],
);
