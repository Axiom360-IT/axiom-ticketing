import type { NextRequest } from "next/server";
import { iterAuditEntries, type AuditFilters } from "@/app/actions/audit";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

// CSV export. Streams chunked rows so large exports never hold the full
// result set in memory. Permission gate is `audit.export` per ARCHITECTURE.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CSV_HEADER = [
  "timestamp",
  "actor_id",
  "actor_name",
  "actor_email",
  "actor_role_snapshot",
  "impersonator_id",
  "impersonator_email",
  "action",
  "target_type",
  "target_id",
  "ip_address",
].join(",");

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s =
    v instanceof Date ? v.toISOString() : typeof v === "string" ? v : String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function isoOrUndefined(v: string | null): string | undefined {
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return new Date(`${v}T00:00:00.000Z`).toISOString();
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
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
  const filters: AuditFilters = {
    from: isoOrUndefined(sp.get("from")),
    to: isoOrUndefined(sp.get("to")),
    actorId: sp.get("actorId") || undefined,
    action: sp.get("action") || undefined,
    targetType: sp.get("targetType") || undefined,
    targetId: sp.get("targetId") || undefined,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`${CSV_HEADER}\n`));
        for await (const row of iterAuditEntries(filters)) {
          const line =
            [
              row.timestamp,
              row.actorId,
              row.actorName,
              row.actorEmail,
              row.actorRoleSnapshot,
              row.impersonatorId,
              row.impersonatorEmail,
              row.action,
              row.targetType,
              row.targetId,
              row.ipAddress,
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
      // Long timeouts: CSVs can be megabytes.
      "Cache-Control": "no-store",
    },
  });
}
