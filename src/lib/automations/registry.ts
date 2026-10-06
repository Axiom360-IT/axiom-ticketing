import type { SettingKey } from "@/lib/settings-registry";

// ── The automation inventory ──────────────────────────────────────────
//
// One row per background job, describing it in terms an operator can act on:
// what it does, when it runs, which switch turns it off, and which settings
// change its behaviour.
//
// `id` MUST equal the Inngest function id. That string is the join between
// this table, the `automation_runs` rows, and the function itself — if they
// drift, the page shows "never run" for a job that runs fine. A test asserts
// the two sides match.
//
// Two kinds, and the difference is the whole reason the page is laid out the
// way it is:
//   scheduled — runs on a clock. Can be switched off safely; nothing waits on
//               it. These get run history and a toggle.
//   reactive  — runs because something happened (an email arrived, a file was
//               uploaded). Switching these off would silently break the
//               product, so they are listed for visibility and have no switch.

export type AutomationKind = "scheduled" | "reactive";

export type AutomationCategory =
  | "intake"
  | "sla"
  | "lifecycle"
  | "billing"
  | "notifications"
  | "housekeeping"
  | "reports";

export type AutomationDef = {
  id: string;
  kind: AutomationKind;
  category: AutomationCategory;
  /** The cron expression exactly as declared in the function. ALWAYS UTC —
   *  not one of these carries a `TZ=` prefix, which is why the UI renders the
   *  operator's local equivalent beside it. */
  cron?: string;
  /** Event name, for reactive jobs. */
  event?: string;
  /** Boolean setting that switches it off. Where the job already had one, that
   *  key is reused rather than adding a second switch for the same thing. */
  enabledKey?: SettingKey;
  /** Settings that change what it does — surfaced inline on the card so the
   *  knob sits next to the thing it turns. */
  settingKeys?: SettingKey[];
  /** True when the job writes an `automation_runs` row. Only scheduled jobs
   *  do: recording every notification send would duplicate the notifications
   *  table and bury the signal. */
  tracked: boolean;
};

export const AUTOMATIONS: AutomationDef[] = [
  // ── Scheduled ────────────────────────────────────────────────────────
  {
    id: "sla-monitor",
    kind: "scheduled",
    category: "sla",
    cron: "*/20 * * * *",
    tracked: true,
    settingKeys: [
      "sla.breach_notify_roles",
      "sla.warning_notify_roles",
      "sla.breach_repeat_hours",
    ],
  },
  {
    id: "unassigned-ticket-monitor",
    kind: "scheduled",
    category: "sla",
    cron: "*/20 * * * *",
    tracked: true,
    enabledKey: "unassigned_alert.enabled",
    settingKeys: [
      "unassigned_alert.threshold_minutes",
      "unassigned_alert.repeat_minutes",
    ],
  },
  {
    id: "customer-followup-monitor",
    kind: "scheduled",
    category: "lifecycle",
    cron: "0 */6 * * *",
    tracked: true,
    enabledKey: "customer_followup.enabled",
    settingKeys: [
      "customer_followup.followup_days",
      "customer_followup.max_reminders",
      "customer_followup.close_days",
      "customer_followup.daily",
    ],
  },
  {
    id: "auto-close-resolved-tickets",
    kind: "scheduled",
    category: "lifecycle",
    cron: "0 * * * *",
    tracked: true,
    enabledKey: "auto_close.enabled",
    settingKeys: ["customer_response_window_hours"],
  },
  {
    id: "monthly-plan-reset",
    kind: "scheduled",
    category: "billing",
    cron: "0 6 * * *",
    tracked: true,
    enabledKey: "monthly_plan_reset.enabled",
  },
  {
    id: "cleanup-old-notifications",
    kind: "scheduled",
    category: "housekeeping",
    cron: "30 3 * * *",
    tracked: true,
    enabledKey: "housekeeping.enabled",
    settingKeys: ["housekeeping.run_history_days"],
  },
  {
    id: "cleanup-stale-lockouts",
    kind: "scheduled",
    category: "housekeeping",
    cron: "45 3 * * *",
    tracked: true,
    enabledKey: "housekeeping.enabled",
  },
  {
    id: "cleanup-stale-drafts",
    kind: "scheduled",
    category: "housekeeping",
    cron: "15 4 * * *",
    tracked: true,
    enabledKey: "housekeeping.enabled",
  },
  {
    id: "scheduled-report-dispatcher",
    kind: "scheduled",
    category: "reports",
    cron: "*/5 * * * *",
    tracked: true,
    enabledKey: "scheduled_reports.enabled",
  },

  // ── Reactive ─────────────────────────────────────────────────────────
  {
    id: "process-inbound-email",
    kind: "reactive",
    category: "intake",
    event: "email/inbound.received",
    tracked: false,
    settingKeys: [
      "inbound_moderation_enabled",
      "inbound_harvest_cc",
      "inbound_sender_allowlist_only",
    ],
  },
  {
    id: "process-customer-import-batch",
    kind: "reactive",
    category: "intake",
    event: "customer-import/batch.requested",
    tracked: false,
    settingKeys: ["customer_invite.expiry_hours"],
  },
  {
    id: "scan-attachment",
    kind: "reactive",
    category: "intake",
    event: "attachment/uploaded",
    tracked: false,
    enabledKey: "virus_scan.enabled",
    settingKeys: ["virus_scan.provider", "virus_scan.endpoint"],
  },
  {
    id: "dispatch-notification",
    kind: "reactive",
    category: "notifications",
    event: "notification/dispatch",
    tracked: false,
  },
  {
    id: "send-email-notification",
    kind: "reactive",
    category: "notifications",
    event: "notification/email",
    tracked: false,
    settingKeys: ["default_sender_name", "default_sender_email"],
  },
  {
    id: "send-sms-notification",
    kind: "reactive",
    category: "notifications",
    event: "notification/sms",
    tracked: false,
    enabledKey: "customer_sms.enabled",
  },
  {
    id: "send-in-app-notification",
    kind: "reactive",
    category: "notifications",
    event: "notification/in-app",
    tracked: false,
  },
  {
    id: "billing-balance-monitor",
    kind: "reactive",
    category: "billing",
    event: "billing/balance.changed",
    tracked: false,
    settingKeys: ["billing.accountant_emails", "billing.accountant_phones"],
  },
  {
    id: "notify-accountant-resolved",
    kind: "reactive",
    category: "billing",
    event: "billing/ticket.resolved",
    tracked: false,
    settingKeys: ["billing.superadmin_receive_copy"],
  },
];

export const AUTOMATION_BY_ID = new Map(AUTOMATIONS.map((a) => [a.id, a]));

export const TRACKED_AUTOMATION_IDS = AUTOMATIONS.filter((a) => a.tracked).map(
  (a) => a.id,
);

/** Every distinct boolean switch across the inventory. */
export const AUTOMATION_ENABLED_KEYS = [
  ...new Set(
    AUTOMATIONS.map((a) => a.enabledKey).filter(
      (k): k is SettingKey => k !== undefined,
    ),
  ),
];
