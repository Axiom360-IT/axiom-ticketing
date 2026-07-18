import type { NextRequest } from "next/server";
import { iterAuditEntries, type AuditFilters } from "@/app/actions/audit";
import { audit } from "@/lib/audit";
import {
  auditActionCategory,
  auditActionLabel,
  auditOutcomeLabel,
  AUDIT_CATEGORY_LABEL,
  friendlyAuditTarget,
} from "@/lib/audit/action-label";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { type ExportDataset, parseExportFormat } from "@/lib/export/dataset";
import { exportResponse } from "@/lib/export/respond";
import { clientIp } from "@/lib/request";

// Audit export. CSV is STREAMED (chunked) so a large log never materializes in
// memory. XLSX/PDF inherently build a whole document, so they're capped — use
// CSV for the complete forensic dump. Permission gate: `audit.export`.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// XLSX/PDF materialize the whole document; cap the row count. CSV is unbounded.
const DOC_CAP = 10000;

// Friendly, reader-facing columns first; raw forensic identifiers after, so a
// non-technical reader sees "Resolved the ticket / Tickets / Success" while an
// investigator still has the exact codes and IDs.
const CSV_HEADER = [
  "When (UTC)",
  "Event",
  "Category",
  "Status",
  "Target",
  "Actor",
  "Actor email",
  "Role",
  "IP address",
  "Action code",
  "Actor ID",
  "Impersonator email",
  "Target type",
  "Target ID",
].join(",");

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s =
    v instanceof Date ? v.toISOString() : typeof v === "string" ? v : String(v);
  // Neutralize spreadsheet formula injection (CWE-1236) — audit cells carry
  // actor names and target labels that can contain user-influenced text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function isoOrUndefined(
  v: string | null,
  endOfDay = false,
): string | undefined {
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
    return new Date(`${v}T${time}Z`).toISOString();
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

function fmtTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthenticated", { status: 401 });
  if (
    !(await can(user, "audit.export", { type: "global" }, productionContext))
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const format = parseExportFormat(sp.get("format"));
  const filters: AuditFilters = {
    from: isoOrUndefined(sp.get("from")),
    to: isoOrUndefined(sp.get("to"), true),
    actorId: sp.get("actorId") || undefined,
    action: sp.get("action") || undefined,
    targetType: sp.get("targetType") || undefined,
    targetId: sp.get("targetId") || undefined,
  };

  // Audit the audit: exporting the log is itself a privileged, security-
  // relevant action and must leave its own record (who, what filters, format,
  // from where). Best-effort — never block the export on it.
  try {
    await audit({
      actorId: user.id,
      action: "audit.export",
      targetType: "audit_log",
      ipAddress: clientIp(request.headers, "global"),
      after: {
        format,
        filters: Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v !== undefined),
        ),
      },
    });
  } catch {
    // Non-fatal.
  }

  // ── CSV: streamed, unbounded ───────────────────────────────────────
  if (format === "csv") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`﻿${CSV_HEADER}\n`));
          for await (const row of iterAuditEntries(filters)) {
            const line =
              [
                fmtTime(row.timestamp),
                auditActionLabel(row.action),
                AUDIT_CATEGORY_LABEL[auditActionCategory(row.action)],
                auditOutcomeLabel(row.outcome),
                friendlyAuditTarget(row),
                row.actorName ?? "System",
                row.actorEmail,
                row.actorRoleSnapshot,
                row.ipAddress,
                row.action,
                row.actorId,
                row.impersonatorEmail,
                row.targetType,
                row.targetId,
              ]
                .map(csvEscape)
                .join(",") + "\n";
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    const filename = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ── XLSX / PDF: capped, human-readable summary ─────────────────────
  const tableRows: (string | number)[][] = [];
  let truncated = false;
  for await (const row of iterAuditEntries(filters)) {
    if (tableRows.length >= DOC_CAP) {
      truncated = true;
      break;
    }
    const actor =
      (row.actorName ?? "System") +
      (row.impersonatorEmail ? ` (via ${row.impersonatorEmail})` : "");
    tableRows.push([
      fmtTime(row.timestamp),
      auditActionLabel(row.action),
      AUDIT_CATEGORY_LABEL[auditActionCategory(row.action)],
      auditOutcomeLabel(row.outcome),
      friendlyAuditTarget(row),
      actor,
      row.ipAddress ?? "—",
    ]);
  }

  const applied = Object.entries(filters)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  const dataset: ExportDataset = {
    title: "Audit log export",
    subtitle: `${tableRows.length} entr${tableRows.length === 1 ? "y" : "ies"}`,
    orientation: "landscape",
    meta: [
      {
        label: "Generated at",
        value: `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      },
      { label: "Filters", value: applied || "none" },
    ],
    sections: [
      {
        kind: "table",
        title: "Audit entries",
        note: truncated
          ? `Capped at ${DOC_CAP} rows — export as CSV for the full log, or narrow the filters.`
          : undefined,
        columns: [
          "Time (UTC)",
          "Event",
          "Category",
          "Status",
          "Target",
          "Actor",
          "IP",
        ],
        rows: tableRows,
      },
    ],
  };

  return exportResponse(dataset, format, "audit");
}
