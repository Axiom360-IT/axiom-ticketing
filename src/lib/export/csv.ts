import type { ExportDataset } from "./dataset";

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralize spreadsheet formula injection (CWE-1236): a cell starting with
  // =, +, -, @, tab or CR is evaluated as a formula by Excel/Sheets. Our cells
  // carry externally-supplied data (ticket subjects, customer/requester names
  // and emails), so prefix a single quote to force literal text. Quoting alone
  // does NOT help — Excel strips quotes and still sees the leading operator.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * A sectioned CSV: a title/meta preamble, then each section as its own block
 * (key/value pairs or a header + rows), blocks separated by a blank line. A
 * UTF-8 BOM is prepended so Excel/Sheets pick up the encoding.
 */
export function buildCsv(dataset: ExportDataset): string {
  const lines: string[] = [];

  lines.push(esc(dataset.title));
  if (dataset.subtitle) lines.push(esc(dataset.subtitle));
  for (const m of dataset.meta ?? []) {
    lines.push(`${esc(m.label)},${esc(m.value)}`);
  }
  lines.push("");

  for (const section of dataset.sections) {
    lines.push(esc(section.title));
    if (section.kind === "keyValues") {
      for (const it of section.items) {
        lines.push(`${esc(it.label)},${esc(it.value)}`);
      }
    } else {
      if (section.note) lines.push(esc(section.note));
      lines.push(section.columns.map(esc).join(","));
      for (const row of section.rows) {
        lines.push(row.map(esc).join(","));
      }
    }
    lines.push("");
  }

  return "﻿" + lines.join("\r\n");
}
