import { BRANDING_LOGO_KEY, loadBranding } from "@/lib/branding/load";
import type { AccentKey } from "@/lib/branding/presets";
import { getSettings } from "@/lib/settings";
import { fetchObject } from "@/lib/storage/signed-urls";

// Branding resolved into a form the PDF/XLSX renderers can use directly: a
// concrete accent hex (not a Tailwind class) and the logo as raw, embeddable
// bytes (not a signed URL).

export type EmbeddableImage = { data: Buffer; type: "png" | "jpeg" };

export type ExportBranding = {
  /** Full brand name, e.g. "Axiom360". */
  name: string;
  /** Accent colour as `#RRGGBB` for header bands / table headers. */
  accentHex: string;
  /** Logo bytes ready to embed, or null (no logo, or an unsupported format). */
  logo: EmbeddableImage | null;
};

// AccentKey → representative hex (Tailwind -600), mirroring how the accent
// renders in the app UI. PDF/XLSX need a concrete colour, not a class name.
const ACCENT_HEX: Record<AccentKey, string> = {
  blue: "#2563eb",
  indigo: "#4f46e5",
  violet: "#7c3aed",
  emerald: "#059669",
  amber: "#d97706",
  rose: "#e11d48",
  slate: "#475569",
};
const FALLBACK_ACCENT = "#0070c0"; // design-system brand chrome

/**
 * Detect a PDF/XLSX-embeddable image by magic bytes. pdfkit and exceljs handle
 * PNG and JPEG only — a WebP (or anything else) logo returns null so the
 * renderers fall back to the text wordmark instead of throwing.
 */
export function detectEmbeddableImage(
  bytes: Uint8Array,
): EmbeddableImage | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { data: Buffer.from(bytes), type: "png" };
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { data: Buffer.from(bytes), type: "jpeg" };
  }
  return null;
}

export async function loadExportBranding(): Promise<ExportBranding> {
  const branding = await loadBranding();
  const name =
    `${branding.brandName}${branding.brandAccent}`.trim() || "Axiom360";
  const accentHex = ACCENT_HEX[branding.accentColor] ?? FALLBACK_ACCENT;

  let logo: EmbeddableImage | null = null;
  const settings = await getSettings<{ [BRANDING_LOGO_KEY]?: unknown }>([
    BRANDING_LOGO_KEY,
  ]);
  const logoKey = settings[BRANDING_LOGO_KEY];
  if (typeof logoKey === "string" && logoKey.length > 0) {
    try {
      const bytes = await fetchObject(logoKey);
      logo = detectEmbeddableImage(bytes);
    } catch {
      // Missing/unreadable object → fall back to the text wordmark.
      logo = null;
    }
  }
  return { name, accentHex, logo };
}
