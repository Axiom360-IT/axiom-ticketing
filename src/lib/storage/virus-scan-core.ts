// Pure helpers for the virus-scan module. Kept dep-free (no DB, no
// settings) so unit tests can exercise them without booting the
// Drizzle client. The settings-aware orchestration lives in
// `virus-scan.ts`.

export type ScanResult =
  | { result: "clean" }
  | { result: "infected"; signature: string }
  | { result: "error"; error: string };

export type ScanProvider = "disabled" | "eicar" | "clamav-rest";

// The classic EICAR signature, broken into halves so the literal
// doesn't trip overzealous AV scanners on this very source file.
const EICAR_PART_A = "X5O!P%@AP[4\\PZX54(P^)7CC)7}";
const EICAR_PART_B = "$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const EICAR_SIGNATURE = `${EICAR_PART_A}${EICAR_PART_B}`;

/**
 * Heuristic local detector for the EICAR test file. Looks for the canonical
 * 68-byte signature anywhere in the buffer (the spec allows leading
 * whitespace + trailing data within ~128 bytes). For our purposes a
 * direct substring match is sufficient.
 */
export function looksLikeEicar(bytes: Uint8Array): boolean {
  // EICAR is pure ASCII; decoding even a binary buffer this way produces
  // a string we can substring-search without crashing on non-UTF-8.
  const text = Buffer.from(bytes).toString("latin1");
  return text.includes(EICAR_SIGNATURE);
}

/**
 * Best-effort parse of the JSON shape clamav-rest-api / clamav-rest
 * returns. Exported for unit tests.
 */
export function parseClamavRestResponse(json: unknown): ScanResult {
  const root = json as Record<string, unknown> | null;
  if (!root || typeof root !== "object") {
    return { result: "error", error: "scanner returned non-object" };
  }

  const data = (root.data ?? root) as Record<string, unknown>;
  const list = Array.isArray(data?.result) ? (data.result as unknown[]) : null;
  if (list && list.length > 0) {
    const first = list[0] as Record<string, unknown>;
    if (first.is_infected === true) {
      const viruses = Array.isArray(first.viruses)
        ? (first.viruses as string[]).join(", ")
        : "unknown";
      return { result: "infected", signature: viruses };
    }
    if (first.is_infected === false) {
      return { result: "clean" };
    }
  }

  // Fallback shapes
  if (root.is_infected === true) {
    const sig = typeof root.signature === "string" ? root.signature : "unknown";
    return { result: "infected", signature: sig };
  }
  if (root.is_infected === false || root.success === true) {
    return { result: "clean" };
  }

  return { result: "error", error: "unrecognised scanner response" };
}
