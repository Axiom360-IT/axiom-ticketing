import { listProcurementForAdmin } from "@/app/actions/procurement";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { type ExportDataset, parseExportFormat } from "@/lib/export/dataset";
import { exportResponse } from "@/lib/export/respond";
import { ForbiddenError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPORT_CAP = 10000;
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const STAGE_LABEL: Record<string, string> = {
  awaiting_customer_payment: "Awaiting payment",
  order_pending: "Order pending",
  order_placed: "Order placed",
  order_completed: "Completed",
};

export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthenticated", { status: 401 });
  if (
    !(await can(user, "procurement.export", { type: "global" }, productionContext))
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const format = parseExportFormat(sp.get("format"));

  // Mirrors the /admin/procurement filter contract. listProcurementForAdmin
  // ALSO enforces procurement.view + scopes strict requesters to their own
  // rows; a role with export-but-not-view (no seeded role, but possible via a
  // custom role) trips its ForbiddenError — surface that as a clean 403.
  let items: Awaited<ReturnType<typeof listProcurementForAdmin>>["items"];
  let total: number;
  try {
    const result = await listProcurementForAdmin({
      status: sp.get("status") ?? undefined,
      type: sp.get("type") ?? undefined,
      q: sp.get("q") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      page: 1,
      pageSize: EXPORT_CAP,
    });
    items = result.items;
    total = result.total;
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return new Response("Forbidden", { status: 403 });
    }
    throw e;
  }

  const dataset: ExportDataset = {
    title: "Procurement export",
    subtitle: `${total} request${total === 1 ? "" : "s"}`,
    meta: [
      {
        label: "Generated at",
        value: `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      },
    ],
    sections: [
      {
        kind: "table",
        title: "Procurement requests",
        note:
          total > items.length
            ? `Showing the first ${items.length} of ${total}.`
            : undefined,
        columns: ["Item", "Type", "Qty", "Est. cost", "Stage", "Requester", "Created"],
        align: ["left", "left", "right", "right", "left", "left", "left"],
        rows: items.map((r) => [
          r.itemName,
          r.type,
          r.quantity,
          r.estimatedCost ? usd.format(Number(r.estimatedCost)) : "—",
          STAGE_LABEL[r.status] ?? r.status,
          r.requestedByEmail,
          r.createdAt.toISOString().slice(0, 10),
        ]),
      },
    ],
  };

  return exportResponse(dataset, format, "procurement");
}
