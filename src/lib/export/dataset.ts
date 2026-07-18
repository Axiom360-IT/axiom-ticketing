// ── Export dataset — a format-agnostic description of an exportable document ──
//
// Each surface (reports, tickets, audit, procurement, …) builds ONE of these;
// the CSV / XLSX / PDF renderers all consume it. Adding a new export is then
// just "build a dataset → wire a route → drop the <ExportMenu>".

export type ExportFormat = "csv" | "xlsx" | "pdf";

// Order used by the export menu (nicest → most portable).
export const EXPORT_FORMATS: readonly ExportFormat[] = ["pdf", "xlsx", "csv"];

export function isExportFormat(v: unknown): v is ExportFormat {
  return v === "csv" || v === "xlsx" || v === "pdf";
}

/** Coerce a `?format=` query value to a supported format (defaults to CSV). */
export function parseExportFormat(raw: string | null | undefined): ExportFormat {
  return isExportFormat(raw) ? raw : "csv";
}

export type KeyValue = { label: string; value: string };

/** A labelled block of metric → value pairs (headline figures). */
export type KeyValueSection = {
  kind: "keyValues";
  title: string;
  items: KeyValue[];
};

/** A tabular block. `align` optionally right-aligns numeric columns. */
export type TableSection = {
  kind: "table";
  title: string;
  columns: string[];
  rows: (string | number)[][];
  /** Per-column alignment; defaults to "left" for any unspecified column. */
  align?: ("left" | "right")[];
  /** Optional note shown under the table title (e.g. a row cap). */
  note?: string;
};

export type Section = KeyValueSection | TableSection;

export type ExportDataset = {
  /** Document title, e.g. "IT Operations Report". */
  title: string;
  /** Optional one-line description / date range. */
  subtitle?: string;
  /** Document-level metadata (generated at/by, scope, filters applied). */
  meta?: KeyValue[];
  sections: Section[];
  /** PDF page orientation — use "landscape" for wide tables. Ignored by
   * CSV/XLSX, which are width-agnostic. Defaults to "portrait". */
  orientation?: "portrait" | "landscape";
};

/** Filesystem-safe `<base>-<YYYY-MM-DD>.<ext>` download name. */
export function exportFilename(
  base: string,
  format: ExportFormat,
  generatedAt: Date,
): string {
  const day = generatedAt.toISOString().slice(0, 10);
  const safe =
    base
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "export";
  return `${safe}-${day}.${format}`;
}
