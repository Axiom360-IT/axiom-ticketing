import "server-only";
import { can, type SessionUser } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import type { SettingKey } from "@/lib/settings-registry";
import { SETTING_TIERS } from "@/lib/settings-registry";

// ── What this user may see and change in Settings ─────────────────────────
//
// Settings are split into two tiers (see SETTING_TIERS), each with its own
// view and update permission. Four `can()` calls are in-memory set lookups —
// the global target has no per-row scope — so computing all four once per
// page is free, and it keeps every caller asking the same question the same
// way instead of re-deriving it.

export type SettingsAccess = {
  viewBusiness: boolean;
  updateBusiness: boolean;
  viewTechnical: boolean;
  updateTechnical: boolean;
  /** Either tier — the gate for the Settings page itself. */
  viewAny: boolean;
};

export async function settingsAccessFor(user: SessionUser): Promise<SettingsAccess> {
  const g = { type: "global" } as const;
  const [viewBusiness, updateBusiness, viewTechnical, updateTechnical] =
    await Promise.all([
      can(user, "settings.view", g, productionContext),
      can(user, "settings.update", g, productionContext),
      can(user, "settings.technical.view", g, productionContext),
      can(user, "settings.technical.update", g, productionContext),
    ]);
  return {
    viewBusiness,
    updateBusiness,
    viewTechnical,
    updateTechnical,
    viewAny: viewBusiness || viewTechnical,
  };
}

/** May this user READ this setting's value? */
export function canViewSetting(access: SettingsAccess, key: SettingKey): boolean {
  return SETTING_TIERS[key] === "technical"
    ? access.viewTechnical
    : access.viewBusiness;
}

/** May this user CHANGE this setting? */
export function canUpdateSetting(access: SettingsAccess, key: SettingKey): boolean {
  return SETTING_TIERS[key] === "technical"
    ? access.updateTechnical
    : access.updateBusiness;
}
