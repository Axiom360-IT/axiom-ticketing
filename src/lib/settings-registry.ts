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

  // SLA-breach notification recipients + repeat escalation. `notify_roles` is
  // the set of staff role NAMES that receive a breach alert (the ticket's own
  // assignee is always notified on top). `repeat_hours` of 0 = alert once; >0
  // re-nags the same recipients on that cadence while the ticket stays breached
  // AND unassigned (once someone owns it, or it's resolved, the nagging stops).
  "sla.breach_notify_roles": z.array(z.string().trim().min(1).max(60)).max(20),
  "sla.breach_repeat_hours": z.number().int().min(0).max(24 * 14),

  // SLA-warning (50%/80%, i.e. not-yet-breached) notification recipients.
  // Same shape as `sla.breach_notify_roles` — the ticket's own assignee is
  // always notified on top and isn't configurable here (there's nothing to
  // pick: whoever owns the ticket gets it).
  "sla.warning_notify_roles": z.array(z.string().trim().min(1).max(60)).max(20),

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
  inbound_harvest_cc: z.boolean(),
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

  // ── Automation switches ──────────────────────────────────────────────
  // Jobs that had no switch of their own. Where a job already had one
  // (customer_followup.enabled, unassigned_alert.enabled, virus_scan.enabled,
  // customer_sms.enabled) that key is reused — two switches for one job is how
  // you end up with a thing that is both on and off.
  "auto_close.enabled": z.boolean(),
  "monthly_plan_reset.enabled": z.boolean(),
  "scheduled_reports.enabled": z.boolean(),

  // ── Automation rules ───────────────────────────────────────────────
  // The master switch for the rule engine. Off stops all three dispatchers;
  // the database trigger keeps filling the outbox harmlessly and housekeeping
  // prunes it, so switching back on resumes rather than replays.
  "rules.enabled": z.boolean(),
  // How many outbox rows one drain handles. Low enough that a backlog is
  // worked through over several passes rather than in one long transaction —
  // the same reasoning that widened the SLA monitor to 20 minutes.
  "rules.drain_batch": z.number().int().min(10).max(2000),
  // How long a processed change event is kept before housekeeping drops it.
  // Only useful for answering "why did that rule fire?", so it is short.
  "rules.event_retention_days": z.number().int().min(1).max(30),
  // How long per-rule activity is kept. Misses are pruned harder (3 days,
  // fixed) because they are diagnostic rather than a record of anything
  // having happened.
  "rules.log_retention_days": z.number().int().min(1).max(365),
  // One switch for all three nightly cleanups: they are the same decision, and
  // nobody wants to disable draft pruning but keep lockout pruning.
  "housekeeping.enabled": z.boolean(),
  // How long automation_runs rows are kept. The monitors run every 20 minutes,
  // so this table grows ~2k rows/day and needs a ceiling.
  "housekeeping.run_history_days": z.number().int().min(1).max(365),
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

  // Customer follow-up + auto-close on no response. When a ticket sits in
  // "awaiting customer" and the customer hasn't replied for `followup_days`,
  // send a one-time nudge email; if still no reply `close_days` after that,
  // auto-close the ticket. `enabled` is the master on/off.
  "customer_followup.enabled": z.boolean(),
  "customer_followup.daily": z.boolean(),
  "customer_followup.followup_days": z.number().int().min(1).max(90),
  "customer_followup.close_days": z.number().int().min(1).max(90),
  "customer_followup.max_reminders": z.number().int().min(1).max(30),

  // Customer bulk-import invites. Controls how long a customer's "set your
  // password" link stays valid after being (re)sent. Enforced independently
  // of Better Auth's own reset-token TTL — see lib/customer/invite-token.ts.
  "customer_invite.expiry_hours": z.number().int().min(1).max(720),

  // Master SMS switch for customers only (staff SMS is unaffected). When
  // off: the SMS column disappears from the customer notification-prefs UI
  // and no SMS — per-event or the profile phone-change confirmation text —
  // is sent to any customer, regardless of their own per-event preference.
  // When on, the column returns; per-event SMS defaults to OFF for a
  // customer who's never touched it (opt-in), not on like every other
  // channel — see dispatch-notification.ts and app/actions/profile.ts.
  "customer_sms.enabled": z.boolean(),

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
    // Optional — a customer can rely on an uploaded logo instead of a wordmark.
    brandName: z.string().trim().max(40),
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

  // ── Permission delegation ──────────────────────────────────────────
  // What a restricted admin sees for a permission or role they are not
  // allowed to hand out. `hidden` (the default) shows nothing at all — no
  // row, no count, no "show locked" link — because a capability people can
  // see but not have is a capability they will ask for. `locked` shows it
  // greyed out with the name of who to ask. Technical tier, so only the
  // Technical Lead can change it.
  "permissions.undelegable_display": z.enum(["hidden", "locked"]),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValueFor<K extends SettingKey> = z.infer<
  (typeof SETTING_SCHEMAS)[K]
>;

export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];

export function isValidSettingKey(k: string): k is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_SCHEMAS, k);
}

// ── Tiers ─────────────────────────────────────────────────────────────
//
// Which side of the line each setting is on. This is what `settings.update`
// could not express while it was ONE permission for every key: business hours
// and the virus-scanner endpoint were the same switch.
//
//   business   what an operations lead changes — hours, SLA targets, holidays,
//              who gets alerted, email wording, billing, follow-up cadence
//   technical  what breaks the system if changed carelessly — rate limits,
//              the scanner, the sender and inbound email addresses, file
//              limits, retention, the rule engine's internals
//
// A TYPED, EXHAUSTIVE record, deliberately. `satisfies Record<SettingKey, …>`
// makes TypeScript refuse to compile a setting that has not been placed on a
// side, so a new key cannot quietly default into the weaker tier.
export type SettingTier = "business" | "technical";

export const SETTING_TIERS = {
  // business hours + SLA
  "business_hours.timezone": "business",
  "business_hours.start_hour": "business",
  "business_hours.end_hour": "business",
  "business_hours.working_days": "business",
  "sla.critical.response_minutes": "business",
  "sla.critical.resolve_minutes": "business",
  "sla.critical.respect_business_hours": "business",
  "sla.high.response_minutes": "business",
  "sla.high.resolve_minutes": "business",
  "sla.high.respect_business_hours": "business",
  "sla.medium.response_minutes": "business",
  "sla.medium.resolve_minutes": "business",
  "sla.medium.respect_business_hours": "business",
  "sla.low.response_minutes": "business",
  "sla.low.resolve_minutes": "business",
  "sla.low.respect_business_hours": "business",
  "sla.breach_notify_roles": "business",
  "sla.breach_repeat_hours": "business",
  "sla.warning_notify_roles": "business",
  // tickets + email policy
  internal_email_domains: "business",
  customer_response_window_hours: "business",
  inbound_sender_allowlist_only: "business",
  inbound_moderation_enabled: "business",
  inbound_harvest_cc: "business",
  procurement_approval_threshold: "business",
  // automation switches an operator turns on and off
  "unassigned_alert.enabled": "business",
  "auto_close.enabled": "business",
  "monthly_plan_reset.enabled": "business",
  "scheduled_reports.enabled": "business",
  "unassigned_alert.threshold_minutes": "business",
  "unassigned_alert.repeat_minutes": "business",
  "customer_followup.enabled": "business",
  "customer_followup.daily": "business",
  "customer_followup.followup_days": "business",
  "customer_followup.close_days": "business",
  "customer_followup.max_reminders": "business",
  "customer_invite.expiry_hours": "business",
  "customer_sms.enabled": "business",
  // billing + branding
  "billing.accountant_emails": "business",
  "billing.accountant_phones": "business",
  "billing.superadmin_receive_copy": "business",
  branding: "business",

  // technical — email identity and routing
  support_email: "technical",
  inbound_email_domain: "technical",
  default_sender_name: "technical",
  default_sender_email: "technical",
  // technical — rate limits
  "rate_limits.public_submit": "technical",
  "rate_limits.login": "technical",
  "rate_limits.password_reset": "technical",
  "rate_limits.guest_portal": "technical",
  "rate_limits.authenticated.create_ticket": "technical",
  "rate_limits.authenticated.reply": "technical",
  "rate_limits.authenticated.internal_note": "technical",
  "rate_limits.authenticated.escalate": "technical",
  "rate_limits.authenticated.create_proc": "technical",
  "rate_limits.authenticated.create_user": "technical",
  "rate_limits.authenticated.create_role": "technical",
  "rate_limits.authenticated.update_setting": "technical",
  // technical — files and scanning
  "file_upload.max_size_bytes": "technical",
  "file_upload.max_files_per_message": "technical",
  "file_upload.allowed_mime_types": "technical",
  "virus_scan.enabled": "technical",
  "virus_scan.provider": "technical",
  "virus_scan.endpoint": "technical",
  // technical — retention and the rule engine
  "housekeeping.enabled": "technical",
  "housekeeping.run_history_days": "technical",
  "rules.enabled": "technical",
  "rules.drain_batch": "technical",
  "rules.event_retention_days": "technical",
  "rules.log_retention_days": "technical",
  // technical — who may see what, so it must not be changeable by those it
  // restricts
  "permissions.undelegable_display": "technical",
} as const satisfies Record<SettingKey, SettingTier>;

export function settingTier(key: SettingKey): SettingTier {
  return SETTING_TIERS[key];
}

/** The permission needed to READ this key. */
export function settingViewPermission(
  key: SettingKey,
): "settings.view" | "settings.technical.view" {
  return SETTING_TIERS[key] === "technical"
    ? "settings.technical.view"
    : "settings.view";
}

/** The permission needed to CHANGE this key. */
export function settingUpdatePermission(
  key: SettingKey,
): "settings.update" | "settings.technical.update" {
  return SETTING_TIERS[key] === "technical"
    ? "settings.technical.update"
    : "settings.update";
}

// Settings whose value is non-mutable after first set (per spec). The UI
// hides the input or disables it; the action layer additionally enforces it.
export const READ_ONLY_AFTER_FIRST_SET: ReadonlySet<SettingKey> = new Set([
  "inbound_email_domain",
]);
