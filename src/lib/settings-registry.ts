import { z } from "zod";
import { ACCENT_KEYS, GRADIENT_KEYS } from "./branding/presets";

// Single source of truth for every settings key the UI is allowed to touch.
// Each key maps to a Zod schema; the action layer validates the incoming
// value through the corresponding schema before writing. Anything outside
// this registry is rejected — callers can't sneak arbitrary keys past the
// `updateSetting` gate.

const HOUR_RANGE = { min: 0, max: 23 } as const;
const DAY_OF_WEEK = z.enum(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

export const SETTING_SCHEMAS = {
  // Business hours
  "business_hours.timezone": z
    .string()
    .min(1)
    .max(64)
    // Reject obviously malformed strings; full IANA validation lives in the
    // SLA module via Intl.DateTimeFormat.
    .regex(/^[A-Za-z_]+\/[A-Za-z_+\-0-9/]+$|^UTC$/),
  "business_hours.start_hour": z.number().int().min(HOUR_RANGE.min).max(HOUR_RANGE.max),
  "business_hours.end_hour": z.number().int().min(HOUR_RANGE.min).max(HOUR_RANGE.max + 1),
  "business_hours.working_days": z.array(DAY_OF_WEEK).min(1).max(7),

  // SLA targets per priority
  "sla.critical.response_minutes": z.number().int().positive().max(60 * 24 * 14),
  "sla.critical.resolve_minutes": z.number().int().positive().max(60 * 24 * 14),
  "sla.critical.respect_business_hours": z.boolean(),
  "sla.high.response_minutes": z.number().int().positive().max(60 * 24 * 14),
  "sla.high.resolve_minutes": z.number().int().positive().max(60 * 24 * 14),
  "sla.high.respect_business_hours": z.boolean(),
  "sla.medium.response_minutes": z.number().int().positive().max(60 * 24 * 14),
  "sla.medium.resolve_minutes": z.number().int().positive().max(60 * 24 * 14),
  "sla.medium.respect_business_hours": z.boolean(),
  "sla.low.response_minutes": z.number().int().positive().max(60 * 24 * 14),
  "sla.low.resolve_minutes": z.number().int().positive().max(60 * 24 * 14),
  "sla.low.respect_business_hours": z.boolean(),

  // Email + stream tagging
  internal_email_domains: z.array(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Domain must be valid (e.g. axiom360.it)"),
  ),
  customer_response_window_hours: z.number().int().min(1).max(720),
  support_email: z.string().trim().toLowerCase().email(),
  inbound_email_domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
  inbound_sender_allowlist_only: z.boolean(),
  // When true (default), inbound replies from senders NOT recognized as the
  // ticket's customer/participant/org are HELD for moderation (req 5.2). When
  // false, every reply posts straight to the conversation thread.
  inbound_moderation_enabled: z.boolean(),
  default_sender_name: z.string().trim().min(1).max(120),
  default_sender_email: z.string().trim().toLowerCase().email(),

  // Procurement
  procurement_approval_threshold: z.number().nonnegative().max(1_000_000),

  // Unassigned-ticket alerts — email admins (Coordinator / IT Director /
  // Super Admin) when a ticket sits with no technician past the threshold.
  // `repeat_minutes` of 0 means alert once; >0 re-nags on that cadence.
  //
  // Both are floored at 20 minutes to match the unassigned-ticket monitor's
  // 20-minute cron: a smaller value can't be honored (the check only runs
  // every 20 min), so we reject it rather than silently round it up.
  "unassigned_alert.enabled": z.boolean(),
  "unassigned_alert.threshold_minutes": z
    .number()
    .int()
    .min(20)
    .max(60 * 24 * 14),
  "unassigned_alert.repeat_minutes": z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 14)
    .refine((v) => v === 0 || v >= 20, {
      message: "Repeat must be 0 (alert once) or at least 20 minutes.",
    }),

  // Billing / accountant notifications (reqs 8.6–8.9). Accountants are OUR
  // platform's accountants (not per-organization contacts) — a global list of
  // email addresses (for negative-balance + ticket-billing alerts) and phone
  // numbers (for the negative-balance SMS). `superadmin_receive_copy` lets the
  // Superadmin opt in to receive the same notifications on their own account.
  "billing.accountant_emails": z.array(
    z.string().trim().toLowerCase().email(),
  ).max(20),
  "billing.accountant_phones": z.array(
    // E.164-ish: a leading + and 7–15 digits. Twilio wants E.164.
    z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Use E.164 format, e.g. +15551234567"),
  ).max(20),
  "billing.superadmin_receive_copy": z.boolean(),

  // Public rate limits
  "rate_limits.public_submit": z.object({
    per_ip_per_hour: z.number().int().positive().max(10_000),
    per_email_per_day: z.number().int().positive().max(10_000),
  }),
  "rate_limits.login": z.object({
    per_ip_per_minute: z.number().int().positive().max(10_000),
  }),
  "rate_limits.password_reset": z.object({
    per_email_per_hour: z.number().int().positive().max(10_000),
    per_ip_per_hour: z.number().int().positive().max(10_000),
  }),
  "rate_limits.guest_portal": z.object({
    per_token_per_minute: z.number().int().positive().max(10_000),
  }),

  // Authenticated rate limits — same shape; one numeric `per_user_*` value.
  "rate_limits.authenticated.create_ticket": z.object({
    per_user_per_hour: z.number().int().positive().max(100_000),
  }),
  "rate_limits.authenticated.reply": z.object({
    per_user_per_hour: z.number().int().positive().max(100_000),
  }),
  "rate_limits.authenticated.internal_note": z.object({
    per_user_per_hour: z.number().int().positive().max(100_000),
  }),
  "rate_limits.authenticated.escalate": z.object({
    per_user_per_hour: z.number().int().positive().max(100_000),
  }),
  "rate_limits.authenticated.create_proc": z.object({
    per_user_per_day: z.number().int().positive().max(100_000),
  }),
  "rate_limits.authenticated.create_user": z.object({
    per_user_per_hour: z.number().int().positive().max(100_000),
  }),
  "rate_limits.authenticated.create_role": z.object({
    per_user_per_day: z.number().int().positive().max(100_000),
  }),
  "rate_limits.authenticated.update_setting": z.object({
    per_user_per_day: z.number().int().positive().max(100_000),
  }),

  // File uploads
  "file_upload.max_size_bytes": z
    .number()
    .int()
    .positive()
    // Capped at the DB CHECK constraint on `attachments.size_bytes`
    // (10 MiB). Raising this requires a schema migration.
    .max(10 * 1024 * 1024),
  "file_upload.max_files_per_message": z.number().int().min(1).max(20),
  "file_upload.allowed_mime_types": z.array(z.string().min(1).max(255)),

  // Branding (public sign-in / submit pages). Atomic object so the
  // four fields move together — no half-updated brand mid-render.
  branding: z.object({
    brandName: z.string().trim().min(1).max(40),
    brandAccent: z.string().trim().max(20),
    accentColor: z.enum(ACCENT_KEYS as unknown as [string, ...string[]]),
    gradientPreset: z.enum(GRADIENT_KEYS as unknown as [string, ...string[]]),
  }),

  // Virus scanning
  "virus_scan.enabled": z.boolean(),
  // Provider for the actual scan. `disabled` is the same as
  // `virus_scan.enabled = false` and is the safe default. `eicar` ships
  // a tiny in-process detector (matches the EICAR test signature) for
  // end-to-end testing of the quarantine pipeline without standing up
  // a real scanner. `clamav-rest` POSTs the bytes to a configurable
  // HTTPS endpoint that speaks clamav-rest-api / clamav-rest.
  "virus_scan.provider": z.enum(["disabled", "eicar", "clamav-rest"]),
  // HTTPS endpoint for the clamav-rest provider. Empty string means
  // "not configured"; the scan-attachment function then reports an
  // error and falls open.
  "virus_scan.endpoint": z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => v === "" || /^https?:\/\//i.test(v),
      "Must be empty or start with http(s)://",
    ),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValueFor<K extends SettingKey> = z.infer<
  (typeof SETTING_SCHEMAS)[K]
>;

export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];

export function isValidSettingKey(k: string): k is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_SCHEMAS, k);
}

// Settings whose value is non-mutable after first set (per spec). The UI
// hides the input or disables it; the action layer additionally enforces it.
export const READ_ONLY_AFTER_FIRST_SET: ReadonlySet<SettingKey> = new Set([
  "inbound_email_domain",
]);
