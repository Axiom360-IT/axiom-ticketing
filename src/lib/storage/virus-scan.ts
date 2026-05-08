import { getSettings } from "../settings";
import {
  looksLikeEicar,
  parseClamavRestResponse,
  type ScanProvider,
  type ScanResult,
} from "./virus-scan-core";

// Virus-scan abstraction (M18). The scan-attachment Inngest function
// calls `scanBytes`; this module owns provider selection and the
// per-provider request/response shape so the Inngest function stays
// focused on orchestration (load row, fetch bytes, route by result).
//
// Three providers:
//   - "disabled" — skip scanning; equivalent to virus_scan.enabled = false
//   - "eicar"    — in-process EICAR signature detector. Detects the
//                  standard EICAR test file (https://www.eicar.org). Cheap,
//                  deterministic, and the right tool for verifying that
//                  the quarantine pipeline works end-to-end without
//                  running a real AV daemon.
//   - "clamav-rest" — POSTs the bytes to a clamav-rest-compatible HTTPS
//                  endpoint and parses the JSON response. Self-hosted
//                  ClamAV behind a small REST shim is the recommended
//                  prod path per the M18 brief.

export type { ScanResult, ScanProvider } from "./virus-scan-core";

type ScannerConfig = {
  enabled: boolean;
  provider: ScanProvider;
  endpoint: string;
};

async function loadConfig(): Promise<ScannerConfig> {
  const s = (await getSettings([
    "virus_scan.enabled",
    "virus_scan.provider",
    "virus_scan.endpoint",
  ])) as Record<string, unknown>;
  const provider = ((s["virus_scan.provider"] as string | undefined) ??
    "disabled") as ScanProvider;
  return {
    enabled: s["virus_scan.enabled"] === true,
    provider: ["disabled", "eicar", "clamav-rest"].includes(provider)
      ? provider
      : "disabled",
    endpoint: typeof s["virus_scan.endpoint"] === "string"
      ? (s["virus_scan.endpoint"] as string)
      : "",
  };
}

/**
 * Scan a buffer using whichever provider Settings has selected. Returns
 * `clean` when scanning is disabled — callers (the scan-attachment
 * Inngest function) should treat that as "no quarantine action needed".
 *
 * On any provider error we return `result: "error"`; the caller decides
 * whether to retry or fail open.
 */
export async function scanBytes(
  bytes: Uint8Array,
  declaredMime: string,
  fileName: string,
): Promise<ScanResult> {
  const cfg = await loadConfig();
  if (!cfg.enabled || cfg.provider === "disabled") {
    return { result: "clean" };
  }

  if (cfg.provider === "eicar") {
    return looksLikeEicar(bytes)
      ? { result: "infected", signature: "EICAR-Test-File" }
      : { result: "clean" };
  }

  // clamav-rest
  if (!cfg.endpoint) {
    return {
      result: "error",
      error: "virus_scan.endpoint is empty",
    };
  }
  return await scanWithClamavRest(cfg.endpoint, bytes, declaredMime, fileName);
}

async function scanWithClamavRest(
  endpoint: string,
  bytes: Uint8Array,
  declaredMime: string,
  fileName: string,
): Promise<ScanResult> {
  // Standard multipart upload — the clamav-rest-api convention is a
  // POST to /scan with a single `FILES` field. We cap the wait at 30s;
  // scan-attachment retries on errors at the Inngest level.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const form = new FormData();
    form.set(
      "FILES",
      new Blob([new Uint8Array(bytes)], { type: declaredMime }),
      fileName,
    );

    const res = await fetch(endpoint, {
      method: "POST",
      body: form,
      signal: ac.signal,
    });
    if (!res.ok) {
      return {
        result: "error",
        error: `scanner HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as unknown;
    return parseClamavRestResponse(json);
  } catch (err) {
    return {
      result: "error",
      error: err instanceof Error ? err.message : "scanner request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
