import { sql } from "drizzle-orm";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { roles } from "@/lib/db/schema/rbac";
import { type ExportDataset, parseExportFormat } from "@/lib/export/dataset";
import { exportResponse } from "@/lib/export/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthenticated", { status: 401 });
  if (!(await can(user, "roles.view", { type: "global" }, productionContext))) {
    return new Response("Forbidden", { status: 403 });
  }

  // Mirrors the /admin/roles filter contract (q + system/custom type).
  const sp = new URL(request.url).searchParams;
  const format = parseExportFormat(sp.get("format"));
  const q = sp.get("q")?.trim().toLowerCase() ?? "";
  const type =
    sp.get("type") === "system"
      ? "system"
      : sp.get("type") === "custom"
        ? "custom"
        : "";

  // Member + permission counts as correlated subqueries (qualified table name).
  const memberCount = sql<number>`(select count(*) from user_roles ur where ur.role_id = "roles"."id")`;
  const permCount = sql<number>`(select count(*) from role_permissions rp where rp.role_id = "roles"."id")`;

  const all = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      memberCount,
      permCount,
    })
    .from(roles)
    .orderBy(roles.name);

  // Filters mirror the page's in-memory filtering.
  let items = all;
  if (q) {
    items = items.filter((r) =>
      `${r.name} ${r.description ?? ""}`.toLowerCase().includes(q),
    );
  }
  if (type === "system") items = items.filter((r) => r.isSystem);
  else if (type === "custom") items = items.filter((r) => !r.isSystem);

  const dataset: ExportDataset = {
    title: "Roles export",
    subtitle: `${items.length} role${items.length === 1 ? "" : "s"}`,
    orientation: "portrait",
    meta: [
      {
        label: "Generated at",
        value: `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      },
    ],
    sections: [
      {
        kind: "table",
        title: "Roles",
        columns: ["Name", "Type", "Members", "Permissions", "Description"],
        align: ["left", "left", "right", "right", "left"],
        rows: items.map((r) => [
          r.name,
          r.isSystem ? "System" : "Custom",
          Number(r.memberCount ?? 0),
          Number(r.permCount ?? 0),
          r.description ?? "—",
        ]),
      },
    ],
  };

  return exportResponse(dataset, format, "roles");
}
