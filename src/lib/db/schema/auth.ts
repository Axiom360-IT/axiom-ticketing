import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ── Better Auth-compatible schema ─────────────────────────────────────
//
// Column names follow Better Auth 1.6.x conventions. The `fields` mapping
// option is intentionally NOT used so this file is the single source of truth
// for the schema, and migrations stay clean.
//
// Application-specific user columns (language, hierarchy, soft-delete) are
// added to the `users` table as additional columns; Better Auth tolerates
// extra columns it doesn't recognise.
//
// 2FA secret + backup codes are stored plaintext in this MVP (Better Auth's
// twoFactor plugin owns those columns). Field-level encryption for those
// values is in BACKLOG (requires wrapping the plugin or a custom adapter).
// ──────────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    // Required by Better Auth twoFactor plugin.
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    // ── Application-specific fields (not part of Better Auth's core) ──
    language: text("language").notNull().default("en"),
    // E.164-formatted phone (e.g. "+14165550123") for SMS notifications.
    // Optional — when null we skip the SMS leg of any notification.
    phone: text("phone"),
    createdById: uuid("created_by_id"),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivatedById: uuid("deactivated_by_id"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("users_email_idx").on(t.email),
    index("users_created_by_id_idx").on(t.createdById),
    index("users_is_active_idx").on(t.isActive),
    foreignKey({
      columns: [t.createdById],
      foreignColumns: [t.id],
      name: "users_created_by_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.deactivatedById],
      foreignColumns: [t.id],
      name: "users_deactivated_by_id_fk",
    }).onDelete("set null"),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    // OAuth fields (null for credential provider, populated for future OAuth)
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    // Credential-provider field: the bcrypt/scrypt password hash (Better Auth-managed)
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Better Auth twoFactor plugin storage.
// `secret` and `backup_codes` are plain text in this MVP — encryption-at-rest
// is provided by Neon; field-level encryption is tracked in BACKLOG.md.
export const twoFactors = pgTable("two_factors", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
});

// Better Auth passkey plugin storage.
export const passkeys = pgTable("passkeys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  credentialId: text("credential_id").notNull().unique(),
  counter: bigint("counter", { mode: "number" }).notNull(),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up").notNull().default(false),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
