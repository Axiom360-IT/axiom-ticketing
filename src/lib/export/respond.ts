import { loadExportBranding } from "./branding-assets";
import { buildCsv } from "./csv";
import {
  type ExportDataset,
  type ExportFormat,
  exportFilename,
} from "./dataset";
import { buildPdf } from "./pdf";
import { buildXlsx } from "./xlsx";

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export type RenderedExport = {
  body: Buffer | string;
  filename: string;
  contentType: string;
};

/**
 * Render a dataset to bytes. CSV is built inline; XLSX/PDF pull the branding
 * (name, accent, logo) so both carry the company's identity.
 *
 * Split out from `exportResponse` so a scheduled report can attach exactly
 * the same bytes to an email that a download would produce. One renderer, so
 * the emailed file and the downloaded file can't drift apart.
 */
export async function renderExport(
  dataset: ExportDataset,
  format: ExportFormat,
  filenameBase: string,
  at: Date = new Date(),
): Promise<RenderedExport> {
  let body: Buffer | string;
  if (format === "csv") {
    body = buildCsv(dataset);
  } else {
    const branding = await loadExportBranding();
    body =
      format === "xlsx"
        ? await buildXlsx(dataset, branding)
        : await buildPdf(dataset, branding);
  }
  return {
    body,
    filename: exportFilename(filenameBase, format, at),
    contentType: CONTENT_TYPES[format],
  };
}

/**
 * Render a dataset in the requested format and return it as a downloadable
 * `Response`.
 */
export async function exportResponse(
  dataset: ExportDataset,
  format: ExportFormat,
  filenameBase: string,
): Promise<Response> {
  const { body, filename } = await renderExport(dataset, format, filenameBase);
  // A Node Buffer is a valid response body at runtime; TS's BodyInit type
  // doesn't model `Buffer<ArrayBufferLike>`, hence the cast.
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
