import ExcelJS from "exceljs";
import type { ExportBranding } from "./branding-assets";
import type { ExportDataset, KeyValueSection, TableSection } from "./dataset";

function argb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

// Excel sheet names: ≤31 chars, none of []:*?/\, and unique per workbook.
function sheetName(title: string, used: Set<string>): string {
  const base =
    title
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || "Sheet";
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${i++})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

/**
 * A styled workbook: a "Summary" sheet carrying the logo, title, meta and every
 * headline (key/value) section, then one sheet per table section with a
 * brand-coloured, frozen header row and auto-fitted columns.
 */
export async function buildXlsx(
  dataset: ExportDataset,
  branding: ExportBranding,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = branding.name;
  const accent = argb(branding.accentHex);
  const used = new Set<string>();

  const kvSections = dataset.sections.filter(
    (s): s is KeyValueSection => s.kind === "keyValues",
  );
  const tableSections = dataset.sections.filter(
    (s): s is TableSection => s.kind === "table",
  );

  // ── Summary sheet ──────────────────────────────────────────────────
  const summary = wb.addWorksheet(sheetName("Summary", used));
  summary.columns = [{ width: 36 }, { width: 48 }];
  let row = 1;
  if (branding.logo) {
    const imgId = wb.addImage({
      buffer: branding.logo.data as unknown as ExcelJS.Buffer,
      extension: branding.logo.type,
    });
    summary.addImage(imgId, {
      tl: { col: 0, row: 0 },
      ext: { width: 140, height: 44 },
    });
    summary.getRow(1).height = 38;
    row = 3;
  }
  const titleCell = summary.getCell(`A${row}`);
  titleCell.value = dataset.title;
  titleCell.font = { bold: true, size: 16 };
  row++;
  if (dataset.subtitle) {
    const c = summary.getCell(`A${row}`);
    c.value = dataset.subtitle;
    c.font = { color: { argb: "FF6B7280" } };
    row++;
  }
  row++;
  for (const m of dataset.meta ?? []) {
    summary.getCell(`A${row}`).value = m.label;
    summary.getCell(`A${row}`).font = { bold: true };
    summary.getCell(`B${row}`).value = m.value;
    row++;
  }
  for (const s of kvSections) {
    row++;
    const h = summary.getCell(`A${row}`);
    h.value = s.title;
    h.font = { bold: true, size: 12, color: { argb: accent } };
    row++;
    for (const it of s.items) {
      summary.getCell(`A${row}`).value = it.label;
      summary.getCell(`B${row}`).value = it.value;
      row++;
    }
  }

  // ── One sheet per table section ────────────────────────────────────
  for (const s of tableSections) {
    const ws = wb.addWorksheet(sheetName(s.title, used));
    // A note (e.g. a row cap) rendered above the header so truncation is never
    // silent — otherwise a capped export reads as complete.
    if (s.note) {
      const noteRow = ws.addRow([s.note]);
      noteRow.font = { italic: true, color: { argb: "FF6B7280" } };
    }
    const header = ws.addRow(s.columns);
    header.height = 18;
    header.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accent } };
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.alignment = { vertical: "middle" };
    });
    for (const r of s.rows) {
      const added = ws.addRow(r);
      s.align?.forEach((a, i) => {
        if (a === "right") {
          added.getCell(i + 1).alignment = { horizontal: "right" };
        }
      });
    }
    // Auto-fit: header vs longest cell, clamped to a sane range.
    ws.columns.forEach((col, i) => {
      let max = String(s.columns[i] ?? "").length;
      for (const r of s.rows) max = Math.max(max, String(r[i] ?? "").length);
      col.width = Math.min(Math.max(max + 2, 10), 60);
    });
    ws.views = [{ state: "frozen", ySplit: s.note ? 2 : 1 }];
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as unknown as ArrayBuffer);
}
