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

/**
 * Render a dataset in the requested format and return it as a downloadable
 * `Response`. CSV is built inline; XLSX/PDF pull the branding (name, accent,
 * logo bytes) so both carry the company's identity.
 */
export async function exportResponse(
  dataset: ExportDataset,
  format: ExportFormat,
  filenameBase: string,
): Promise<Response> {
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

  const filename = exportFilename(filenameBase, format, new Date());
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
