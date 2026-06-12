import { headers } from "next/headers";

const ISO2 = /^[A-Z]{2}$/;

/**
 * Best-effort ISO 3166-1 alpha-2 country of the current request, read from the
 * CDN/edge geo header — Vercel (`x-vercel-ip-country`) or Cloudflare
 * (`cf-ipcountry`). Used to default the phone-number country to where the
 * visitor actually is (no third-party API, no client geolocation prompt).
 *
 * Falls back to Canada (the primary client base) when geo is unavailable: local
 * dev, a missing header, a non-geo host, or an unknown/Tor value.
 */
export async function getRequestCountry(fallback = "CA"): Promise<string> {
  try {
    const h = await headers();
    const code = (h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? "")
      .trim()
      .toUpperCase();
    // Cloudflare returns "XX"/"T1" for unknown/Tor; ignore non-ISO values.
    if (ISO2.test(code) && code !== "XX" && code !== "T1") return code;
  } catch {
    // headers() unavailable (static context) — use the fallback.
  }
  return fallback;
}
