import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrgTriageRow } from "@/components/organizations/org-triage-row";
import {
  listActiveOrganizations,
  listUnverifiedOrgTickets,
} from "@/app/actions/organizations";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

export default async function OrgTriagePage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(
      user,
      "organizations.update",
      { type: "global" },
      productionContext,
    ))
  ) {
    redirect("/admin");
  }

  const [rows, organizations] = await Promise.all([
    listUnverifiedOrgTickets(),
    listActiveOrganizations(),
  ]);
  const orgOptions = organizations.map((o) => ({ id: o.id, name: o.name }));

  const t = await getTranslations("orgTriage");
  const formatter = await getFormatter();

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t("columns.ticket")}</TableHead>
                    <TableHead scope="col">{t("columns.customer")}</TableHead>
                    <TableHead scope="col">{t("columns.claimed")}</TableHead>
                    <TableHead scope="col">{t("columns.date")}</TableHead>
                    <TableHead scope="col">{t("columns.action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          href={`/admin/tickets/${r.id}`}
                          className="font-mono text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {r.ticketNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {r.customerName}
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {r.customerEmail}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">
                        {r.customerCompany ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                        {formatter.dateTime(r.createdAt, { dateStyle: "medium" })}
                      </TableCell>
                      <TableCell>
                        <OrgTriageRow
                          ticketId={r.id}
                          claimedCompany={r.customerCompany}
                          organizations={orgOptions}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
