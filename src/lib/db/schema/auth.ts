import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Postgres bytea type for binary data (passkey public keys).
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    language: text("language").notNull().default("en"),
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
      .references(() => users.id, { onDelete: "restrict" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique("accounts_provider_account_unique").on(t.providerId, t.accountId),
    index("accounts_user_id_idx").on(t.userId),
  ],
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
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export const verificationTokens = pgTable("verification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Sensitive columns: secret + backup_codes are AES-256-GCM-encrypted (lib/crypto.ts).
export const twoFactor = pgTable("two_factor", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secretEncrypted: text("secret_encrypted").notNull(),
  backupCodesEncrypted: text("backup_codes_encrypted").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
});

export const passkeys = pgTable("passkeys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: bytea("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull(),
  deviceName: text("device_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
