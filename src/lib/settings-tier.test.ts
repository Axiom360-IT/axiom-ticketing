import { describe, expect, it } from "vitest";
import {
  SETTING_KEYS,
  SETTING_TIERS,
  settingTier,
  settingUpdatePermission,
  settingViewPermission,
  type SettingKey,
} from "./settings-registry";

// The line between "an operations lead may change this" and "this breaks the
// system if changed carelessly". The compiler already guarantees every key has
// a tier (SETTING_TIERS is `satisfies Record<SettingKey, …>`); what it cannot
// guarantee is that the line is in the right PLACE. Pinning the technical set
// here means moving a key across it is a deliberate edit to this file, not a
// side effect of someone adding a setting.

const TECHNICAL: SettingKey[] = [
  "support_email",
  "inbound_email_domain",
  "default_sender_name",
  "default_sender_email",
  "rate_limits.public_submit",
  "rate_limits.login",
  "rate_limits.password_reset",
  "rate_limits.guest_portal",
  "rate_limits.authenticated.create_ticket",
  "rate_limits.authenticated.reply",
  "rate_limits.authenticated.internal_note",
  "rate_limits.authenticated.escalate",
  "rate_limits.authenticated.create_proc",
  "rate_limits.authenticated.create_user",
  "rate_limits.authenticated.create_role",
  "rate_limits.authenticated.update_setting",
  "file_upload.max_size_bytes",
  "file_upload.max_files_per_message",
  "file_upload.allowed_mime_types",
  "virus_scan.enabled",
  "virus_scan.provider",
  "virus_scan.endpoint",
  "housekeeping.enabled",
  "housekeeping.run_history_days",
  "rules.enabled",
  "rules.drain_batch",
  "rules.event_retention_days",
  "rules.log_retention_days",
  "permissions.undelegable_display",
];

describe("setting tiers", () => {
  it("places every setting on a side", () => {
    expect(Object.keys(SETTING_TIERS).sort()).toEqual([...SETTING_KEYS].sort());
  });

  it("pins the technical set", () => {
    const actual = SETTING_KEYS.filter((k) => SETTING_TIERS[k] === "technical").sort();
    expect(actual).toEqual([...TECHNICAL].sort());
  });

  it("keeps everything else business", () => {
    for (const k of SETTING_KEYS) {
      if (!TECHNICAL.includes(k)) expect(SETTING_TIERS[k], k).toBe("business");
    }
  });

  it("puts the visibility policy on the technical side, so the people it restricts cannot loosen it", () => {
    expect(settingTier("permissions.undelegable_display")).toBe("technical");
  });

  it("keeps the knobs an operations lead actually turns on the business side", () => {
    for (const k of [
      "business_hours.timezone",
      "sla.critical.response_minutes",
      "unassigned_alert.enabled",
      "billing.accountant_emails",
      "customer_followup.enabled",
      "branding",
    ] as SettingKey[]) {
      expect(settingTier(k), k).toBe("business");
    }
  });
});

describe("the permission a setting needs", () => {
  it("maps business settings to settings.view / settings.update", () => {
    expect(settingViewPermission("business_hours.timezone")).toBe("settings.view");
    expect(settingUpdatePermission("business_hours.timezone")).toBe("settings.update");
  });

  it("maps technical settings to the technical pair", () => {
    expect(settingViewPermission("virus_scan.endpoint")).toBe("settings.technical.view");
    expect(settingUpdatePermission("virus_scan.endpoint")).toBe("settings.technical.update");
  });
});
