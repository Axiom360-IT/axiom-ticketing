import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import {
  loadProcurementSpend,
  loadTicketHealth,
} from "@/lib/reports/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtRate(r: number | null): string {
  if (r === null) return "";
  return `${(r * 100).toFixed(1)}%`;
}

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthenticated", { status: 401 });
  if (
    !(await can(user, "reports.export", { type: "global" }, productionContext))
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const [tickets, procurement] = await Promise.all([
    loadTicketHealth(),
    loadProcurementSpend(),
  ]);

  const rows: [string, string][] = [
    ["section", "metric"],
    ["tickets", "total_last_7d"],
    ["tickets", "total_last_30d"],
    ["tickets", "total_all_time"],
    ["tickets", "average_resolution_minutes"],
    ["tickets", "csat_rate"],
    ["tickets", "csat_satisfied"],
    ["tickets", "csat_unsatisfied"],
    ["tickets", "escalation_rate"],
    ["tickets", "sla_compliance_rate"],
    ["procurement", "spend_last_30d_usd"],
    ["procurement", "spend_last_90d_usd"],
    ["procurement", "spend_last_12mo_usd"],
    ["procurement", "pending_approvals_count"],
    ["procurement", "pending_approvals_total_usd"],
  ];

  const values: Record<string, string> = {
    total_last_7d: String(tickets.totalsByWindow.week),
    total_last_30d: String(tickets.totalsByWindow.month),
    total_all_time: String(tickets.totalsByWindow.allTime),
    average_resolution_minutes:
      tickets.averageResolutionMinutes !== null
        ? String(tickets.averageResolutionMinutes)
        : "",
    csat_rate: fmtRate(tickets.csatRate.rate),
    csat_satisfied: String(tickets.csatRate.satisfied),
    csat_unsatisfied: String(tickets.csatRate.unsatisfied),
    escalation_rate: fmtRate(tickets.escalationRate),
    sla_compliance_rate: fmtRate(tickets.slaComplianceRate),
    spend_last_30d_usd: procurement.totalsByWindow.month.toFixed(2),
    spend_last_90d_usd: procurement.totalsByWindow.quarter.toFixed(2),
    spend_last_12mo_usd: procurement.totalsByWindow.year.toFixed(2),
    pending_approvals_count: String(procurement.pendingApprovals.count),
    pending_approvals_total_usd: procurement.pendingApprovals.total.toFixed(2),
  };

  let csv = "section,metric,value\n";
  for (const [section, metric] of rows.slice(1)) {
    csv += `${csvEscape(section)},${csvEscape(metric)},${csvEscape(values[metric])}\n`;
  }

  // Per-status counts, per-stream counts, per-tech load — appended as
  // additional rows so the CSV is self-describing.
  csv += "\n";
  csv += "tickets_by_status,status,count\n";
  for (const r of tickets.byStatus) {
    csv += `tickets_by_status,${csvEscape(r.status)},${r.count}\n`;
  }
  csv += "\n";
  csv += "tickets_by_stream,stream,count\n";
  for (const r of tickets.byStream) {
    csv += `tickets_by_stream,${csvEscape(r.stream)},${r.count}\n`;
  }
  csv += "\n";
  csv += "tech_load,user,assigned,resolved\n";
  for (const r of tickets.techLoad) {
    csv += `tech_load,${csvEscape(r.name)},${r.assigned},${r.resolved}\n`;
  }
  csv += "\n";
  csv += "procurement_by_type,type,total_usd\n";
  for (const r of procurement.byType) {
    csv += `procurement_by_type,${csvEscape(r.type)},${r.total.toFixed(2)}\n`;
  }
  csv += "\n";
  csv += "procurement_by_stage,status,total_usd,count\n";
  for (const r of procurement.byStatus) {
    csv += `procurement_by_stage,${csvEscape(r.status)},${r.total.toFixed(2)},${r.count}\n`;
  }
  csv += "\n";
  csv += "procurement_top_items,item,total_usd\n";
  for (const r of procurement.topItems) {
    csv += `procurement_top_items,${csvEscape(r.itemName)},${r.total.toFixed(2)}\n`;
  }

  const filename = `reports-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
