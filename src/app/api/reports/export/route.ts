import { eq } from "drizzle-orm";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { parseExportFormat } from "@/lib/export/dataset";
import { exportResponse } from "@/lib/export/respond";
import { buildReportDataset } from "@/lib/reports/dataset";
import {
  loadCsatStats,
  loadProcurementSpend,
  loadTicketHealth,
  parseReportRange,
} from "@/lib/reports/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthenticated", { status: 401 });
  if (
    !(await can(user, "reports.export", { type: "global" }, productionContext))
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const format = parseExportFormat(sp.get("format"));
  const range = parseReportRange(
    sp.get("from") ?? undefined,
    sp.get("to") ?? undefined,
  );

  const [tickets, procurement, csat, me] = await Promise.all([
    loadTicketHealth(range),
    loadProcurementSpend(range),
    loadCsatStats(range),
    db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1),
  ]);

  const dataset = buildReportDataset(
    tickets,
    procurement,
    csat,
    me[0]?.name ?? "—",
    range,
  );
  return exportResponse(dataset, format, "reports");
}
