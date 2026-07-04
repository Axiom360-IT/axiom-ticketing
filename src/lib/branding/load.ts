import { getSettings } from "@/lib/settings";
import { getAvatarSignedUrl } from "@/lib/storage/signed-urls";
import {
  DEFAULT_BRANDING,
  isAccentKey,
  isGradientKey,
  type BrandingConfig,
} from "./presets";

// The uploaded logo is stored under its OWN settings key (a storage-key
// string), separate from the `branding` object, so the branding text/color
// form and the logo uploader never overwrite each other's value.
export const BRANDING_LOGO_KEY = "branding.logo_key";

// Server-side branding loader. Reads the single `branding` setting key
// and normalizes any stored values back to known presets — if a row
// becomes corrupt (or a preset is removed in code), we silently fall
// back to defaults instead of crashing the sign-in page.

export async function loadBranding(): Promise<BrandingConfig> {
  const all = await getSettings<{
    branding?: unknown;
    [BRANDING_LOGO_KEY]?: unknown;
  }>(["branding", BRANDING_LOGO_KEY]);
  const raw = all.branding;

  // Resolve the logo (if any) to a short-lived signed URL for display.
  const logoKey = all[BRANDING_LOGO_KEY];
  const logoUrl =
    typeof logoKey === "string" && logoKey.length > 0
      ? await getAvatarSignedUrl(logoKey).catch(() => null)
      : null;

  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_BRANDING, logoUrl };
  }
  const r = raw as Record<string, unknown>;
  const brandName =
    typeof r.brandName === "string" && r.brandName.trim().length > 0
      ? r.brandName.trim()
      : DEFAULT_BRANDING.brandName;
  const brandAccent =
    typeof r.brandAccent === "string" ? r.brandAccent.trim() : DEFAULT_BRANDING.brandAccent;
  const accentColor = isAccentKey(r.accentColor)
    ? r.accentColor
    : DEFAULT_BRANDING.accentColor;
  const gradientPreset = isGradientKey(r.gradientPreset)
    ? r.gradientPreset
    : DEFAULT_BRANDING.gradientPreset;
  return { brandName, brandAccent, accentColor, gradientPreset, logoUrl };
}
