import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOnBehalfForm } from "@/components/tickets/create-on-behalf-form";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Create ticket — Axiom360" };

export default async function NewTicketPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const allowed = await can(
    user,
    "tickets.create",
    { type: "global" },
    productionContext,
  );
  if (!allowed) redirect("/admin/tickets");

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Create ticket on behalf</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Use this when a customer reports an issue by phone or in person. The
          customer will receive the standard confirmation email.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Ticket details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateOnBehalfForm />
        </CardContent>
      </Card>
    </div>
  );
}
