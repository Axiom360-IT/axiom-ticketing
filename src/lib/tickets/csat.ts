// Pure CSAT (customer-satisfaction) helpers — the three-point emoji scale.
// No DB / server-only imports so this is safe to import from client components
// (the emoji picker) AND server code (the apply logic, the token route).
//
//   happy   (😊) → ticket CLOSES; comment optional
//   neutral (😐) → ticket CLOSES; comment optional
//   unhappy (☹️) → ticket REOPENS; comment MANDATORY

export const CSAT_RATINGS = ["happy", "neutral", "unhappy"] as const;
export type CsatRating = (typeof CSAT_RATINGS)[number];

export function isCsatRating(value: unknown): value is CsatRating {
  return (
    typeof value === "string" &&
    (CSAT_RATINGS as readonly string[]).includes(value)
  );
}

/** happy/neutral close the ticket; unhappy reopens it. */
export function ratingClosesTicket(rating: CsatRating): boolean {
  return rating !== "unhappy";
}

/** Only an unhappy rating forces the customer to explain (comment required). */
export function commentRequiredFor(rating: CsatRating): boolean {
  return rating === "unhappy";
}

/**
 * Map the 3-point rating onto the legacy binary `csat_response` column so the
 * existing close/reopen atomic guards and CSAT reports keep working unchanged.
 * happy + neutral both count as "satisfied" (the ticket closes); unhappy is
 * "unsatisfied" (the ticket reopens).
 */
export function ratingToResponse(
  rating: CsatRating,
): "satisfied" | "unsatisfied" {
  return rating === "unhappy" ? "unsatisfied" : "satisfied";
}
