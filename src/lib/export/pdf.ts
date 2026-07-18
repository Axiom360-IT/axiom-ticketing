import PDFDocument from "pdfkit";
import type { ExportBranding } from "./branding-assets";
import type { ExportDataset, TableSection } from "./dataset";

// A branded, multi-page PDF: logo header band, section key/value blocks and
// tables (paginated, with a repeated header row), and a page-numbered footer on
// every page. Only pdfkit's built-in Helvetica fonts are used, so there are no
// font files to resolve at runtime.

const INK = "#18181b";
const MUTED = "#52525b";
const FAINT = "#a1a1aa";
const RULE = "#e4e5ea";
const ZEBRA = "#f4f5f7";

type Doc = PDFKit.PDFDocument;

export async function buildPdf(
  dataset: ExportDataset,
  branding: ExportBranding,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: dataset.orientation === "landscape" ? "landscape" : "portrait",
      margins: { top: 48, bottom: 56, left: 48, right: 48 },
      bufferPages: true,
      info: { Title: dataset.title, Author: branding.name },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      drawHeader(doc, dataset, branding);
      for (const section of dataset.sections) {
        drawSection(doc, section, branding);
      }
      drawFooters(doc, branding);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function contentWidth(doc: Doc): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}
function bottomLimit(doc: Doc): number {
  // Leave room above the footer band.
  return doc.page.height - doc.page.margins.bottom - 18;
}

function drawHeader(doc: Doc, dataset: ExportDataset, branding: ExportBranding) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const top = doc.page.margins.top;

  if (branding.logo) {
    try {
      doc.image(branding.logo.data, left, top, { fit: [170, 42] });
    } catch {
      wordmark(doc, branding, left, top);
    }
  } else {
    wordmark(doc, branding, left, top);
  }
  // Brand name, top-right.
  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor(FAINT)
    .text(branding.name, left, top + 4, { width, align: "right" });

  doc.y = top + 52;
  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .fillColor(INK)
    .text(dataset.title, left, doc.y);
  if (dataset.subtitle) {
    doc
      .moveDown(0.2)
      .fontSize(10)
      .font("Helvetica")
      .fillColor(MUTED)
      .text(dataset.subtitle, left);
  }

  // Accent rule.
  doc.moveDown(0.5);
  const ry = doc.y;
  doc.rect(left, ry, width, 2).fill(branding.accentHex);
  doc.y = ry + 10;
  doc.fillColor(INK);

  if (dataset.meta?.length) {
    doc.fontSize(8.5).font("Helvetica").fillColor(MUTED);
    for (const m of dataset.meta) {
      doc.text(`${m.label}: ${m.value}`, left, doc.y);
    }
    doc.fillColor(INK);
  }
  doc.moveDown(1);
}

function wordmark(doc: Doc, branding: ExportBranding, x: number, y: number) {
  doc
    .fontSize(22)
    .font("Helvetica-Bold")
    .fillColor(branding.accentHex)
    .text(branding.name, x, y);
}

function drawSection(
  doc: Doc,
  section: ExportDataset["sections"][number],
  branding: ExportBranding,
) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  // Keep the section title with at least its first rows (avoid an orphan title
  // at the very bottom of a page).
  if (doc.y + 60 > bottomLimit(doc)) doc.addPage();

  doc
    .fontSize(12)
    .font("Helvetica-Bold")
    .fillColor(INK)
    .text(section.title, left, doc.y);
  doc.moveDown(0.35);

  if (section.kind === "keyValues") {
    const labelW = width * 0.62;
    const valueW = width - labelW;
    doc.fontSize(10).font("Helvetica");
    for (const it of section.items) {
      if (doc.y + 16 > bottomLimit(doc)) doc.addPage();
      const y = doc.y;
      doc.fillColor(MUTED).text(it.label, left, y, { width: labelW });
      const afterLabel = doc.y;
      doc.y = y;
      doc
        .fillColor(INK)
        .text(it.value, left + labelW, y, { width: valueW, align: "right" });
      doc.y = Math.max(afterLabel, doc.y) + 3;
    }
    doc.moveDown(0.8);
  } else {
    drawTable(doc, section, branding);
    doc.moveDown(0.8);
  }
}

function drawTable(doc: Doc, table: TableSection, branding: ExportBranding) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const cols = table.columns;
  const n = cols.length;
  const padding = 4;
  const fontSize = 8;
  const headerH = 18;

  if (table.note) {
    doc
      .fontSize(8)
      .font("Helvetica-Oblique")
      .fillColor(FAINT)
      .text(table.note, left, doc.y);
    doc.moveDown(0.3);
    doc.font("Helvetica").fillColor(INK);
  }

  // ── Column widths by real text measurement ──────────────────────────
  // Each column is FLOORED at its header width (so a header never wraps
  // mid-word) and desires the width of its widest cell, capped — so a long
  // email/subject wraps to a couple of lines instead of starving the row.
  // Any leftover width is shared by how much each column still wants.
  const MAX_CELL_W = 150;
  const sampleStep = Math.max(1, Math.floor(table.rows.length / 250));
  doc.fontSize(fontSize);
  const minW: number[] = [];
  const idealW: number[] = [];
  for (let i = 0; i < n; i++) {
    doc.font("Helvetica-Bold");
    const headerW = doc.widthOfString(String(cols[i])) + 2 * padding + 2;
    doc.font("Helvetica");
    let cellW = 0;
    for (let r = 0; r < table.rows.length; r += sampleStep) {
      cellW = Math.max(cellW, doc.widthOfString(String(table.rows[r][i] ?? "")));
    }
    cellW = Math.min(cellW, MAX_CELL_W) + 2 * padding;
    minW.push(headerW);
    idealW.push(Math.max(cellW, headerW));
  }
  const totalMin = minW.reduce((a, b) => a + b, 0);
  const totalIdeal = idealW.reduce((a, b) => a + b, 0);
  let colW: number[];
  if (totalIdeal <= width) {
    const slack = width - totalIdeal;
    colW = idealW.map((w) => w + (slack * w) / totalIdeal);
  } else if (totalMin <= width) {
    const demand = idealW.map((w, i) => w - minW[i]);
    const totalDemand = demand.reduce((a, b) => a + b, 0) || 1;
    const slack = width - totalMin;
    colW = minW.map((w, i) => w + (slack * demand[i]) / totalDemand);
  } else {
    // Even the headers overflow — scale down proportionally (headers then fall
    // back to single-line ellipsis, which is the least-bad option).
    colW = minW.map((w) => (w * width) / totalMin);
  }
  const align = (i: number): "left" | "right" =>
    table.align?.[i] === "right" ? "right" : "left";

  const drawHeaderRow = () => {
    const y = doc.y;
    doc.rect(left, y, width, headerH).fill(branding.accentHex);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(fontSize);
    let x = left;
    for (let i = 0; i < n; i++) {
      doc.text(String(cols[i]), x + padding, y + padding + 1, {
        width: colW[i] - 2 * padding,
        align: align(i),
        lineBreak: false,
        ellipsis: true,
      });
      x += colW[i];
    }
    doc.y = y + headerH;
    doc.font("Helvetica").fillColor(INK);
  };

  const measure = (row: (string | number)[]) => {
    doc.fontSize(fontSize);
    let h = 0;
    for (let i = 0; i < n; i++) {
      h = Math.max(
        h,
        doc.heightOfString(String(row[i] ?? ""), {
          width: colW[i] - 2 * padding,
        }),
      );
    }
    return h + 2 * padding;
  };

  drawHeaderRow();
  table.rows.forEach((row, idx) => {
    const h = measure(row);
    if (doc.y + h > bottomLimit(doc)) {
      doc.addPage();
      drawHeaderRow();
    }
    const y = doc.y;
    if (idx % 2 === 1) {
      doc.rect(left, y, width, h).fill(ZEBRA);
    }
    doc.fillColor(INK).font("Helvetica").fontSize(fontSize);
    let x = left;
    for (let i = 0; i < n; i++) {
      doc.text(String(row[i] ?? ""), x + padding, y + padding, {
        width: colW[i] - 2 * padding,
        align: align(i),
      });
      x += colW[i];
    }
    doc.y = y + h;
    doc
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
  });
}

function drawFooters(doc: Doc, branding: ExportBranding) {
  const range = doc.bufferedPageRange();
  const generated = new Date();
  const stamp = `${branding.name} · generated ${generated.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    const y = doc.page.height - doc.page.margins.bottom + 10;
    doc.fontSize(8).font("Helvetica").fillColor(FAINT);
    doc.text(stamp, left, y, { lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, left, y, {
      width,
      align: "right",
      lineBreak: false,
    });
  }
}
