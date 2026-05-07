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
import { messages } from "./messages";
import { tickets } from "./tickets";

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "restrict" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    uploadedByEmail: text("uploaded_by_email").notNull(),
    fileName: text("file_name").notNull(),
    originalFileName: text("original_file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    scanStatus: text("scan_status").notNull().default("pending"),
    scanCompletedAt: timestamp("scan_completed_at", { withTimezone: true }),
    uploadConfirmedAt: timestamp("upload_confirmed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("attachments_ticket_id_idx").on(t.ticketId),
    index("attachments_message_id_idx").on(t.messageId),
    index("attachments_scan_pending_idx")
      .on(t.scanStatus)
      .where(sql`${t.scanStatus} = 'pending'`),
    index("attachments_orphan_cleanup_idx")
      .on(t.createdAt)
      .where(sql`${t.uploadConfirmedAt} IS NULL`),
    check(
      "attachments_size_check",
      sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 10485760`,
    ),
    check(
      "attachments_scan_status_check",
      sql`${t.scanStatus} IN ('pending','clean','quarantined')`,
    ),
  ],
);
