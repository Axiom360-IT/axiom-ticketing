// Shared CSAT rating vocabulary + emoji map, used by the tickets list column,
// its filter facet, the dashboard feedback tiles (clickable → filtered list),
// and the export. `tickets.csat_rating` is one of these three values, or null
// when the customer hasn't rated. The i18n label for each lives under
// `tickets.csat.response{Happy,Neutral,Unhappy}`.
export const CSAT_RATINGS = ["happy", "neutral", "unhappy"] as const;
export type CsatRating = (typeof CSAT_RATINGS)[number];

export const CSAT_EMOJI: Record<CsatRating, string> = {
  happy: "😊",
  neutral: "😐",
  unhappy: "☹️",
};

/** The `tickets.csat` i18n key for a rating's short label. */
export const CSAT_LABEL_KEY: Record<CsatRating, string> = {
  happy: "responseHappy",
  neutral: "responseNeutral",
  unhappy: "responseUnhappy",
};
