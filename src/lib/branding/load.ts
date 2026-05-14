import { getSetting } from "@/lib/settings";
import {
  DEFAULT_BRANDING,
  isAccentKey,
  isGradientKey,
  type BrandingConfig,
} from "./presets";

// Server-side branding loader. Reads the single `branding` setting key
// and normalizes any stored values back to known presets — if a row
// becomes corrupt (or a preset is removed in code), we silently fall
// back to defaults instead of crashing the sign-in page.

export async function loadBranding(): Promise<BrandingConfig> {
  const raw = await getSetting<Record<string, unknown>>("branding");
  if (!raw || typeof raw !== "object") return DEFAULT_BRANDING;
  const brandName =
    typeof raw.brandName === "string" && raw.brandName.trim().length > 0
      ? raw.brandName.trim()
      : DEFAULT_BRANDING.brandName;
  const brandAccent =
    typeof raw.brandAccent === "string" ? raw.brandAccent.trim() : DEFAULT_BRANDING.brandAccent;
  const accentColor = isAccentKey(raw.accentColor)
    ? raw.accentColor
    : DEFAULT_BRANDING.accentColor;
  const gradientPreset = isGradientKey(raw.gradientPreset)
    ? raw.gradientPreset
    : DEFAULT_BRANDING.gradientPreset;
  return { brandName, brandAccent, accentColor, gradientPreset };
}
