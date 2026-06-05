import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { HeldMessageCard } from "@/components/moderation/held-message-card";
import { listHeldMessages } from "@/app/actions/moderation";
import { getSessionUser } from "@/lib/auth/session";

export default async function ModerationPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  // Any ticket-updating staffer can reach the queue; the list itself is scoped
  // to the tickets they can see, and each action re-checks per ticket.
  if (!user.permissions.has("tickets.update")) redirect("/admin");

  const held = await listHeldMessages();
  const t = await getTranslations("moderation");
  const formatter = await getFormatter();

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </div>

      {held.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {held.map((m) => (
            <li key={m.id}>
              <HeldMessageCard
                message={{
                  id: m.id,
                  ticketId: m.ticketId,
                  ticketNumber: m.ticketNumber,
                  ticketSubject: m.ticketSubject,
                  authorName: m.authorName,
                  authorEmail: m.authorEmail,
                  body: m.body,
                  receivedAt: formatter.dateTime(m.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
