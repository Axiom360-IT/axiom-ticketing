import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { HeldMessageCard } from "@/components/moderation/held-message-card";
import { PendingParticipantCard } from "@/components/moderation/pending-participant-card";
import {
  listHeldMessages,
  listPendingParticipantsForModeration,
} from "@/app/actions/moderation";
import { getSessionUser } from "@/lib/auth/session";
import { emailDomain } from "@/lib/tickets/org";
import { db } from "@/lib/db/client";
import { organizationDomains } from "@/lib/db/schema/organizations";
import { inArray } from "drizzle-orm";

export default async function ModerationPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  // Any ticket-updating staffer can reach the queue; the list itself is scoped
  // to the tickets they can see, and each action re-checks per ticket.
  if (!user.permissions.has("tickets.update")) redirect("/admin");

  const [held, pendingParticipants] = await Promise.all([
    listHeldMessages(),
    listPendingParticipantsForModeration(),
  ]);

  // Whether each proposed address sits on a domain registered to its ticket's
  // org — the single most useful signal for the approver, resolved in one
  // query rather than per card.
  const orgIds = [
    ...new Set(
      pendingParticipants
        .map((p) => p.organizationId)
        .filter((v): v is string => v !== null),
    ),
  ];
  const orgDomainRows =
    orgIds.length > 0
      ? await db
          .select({
            organizationId: organizationDomains.organizationId,
            domain: organizationDomains.domain,
          })
          .from(organizationDomains)
          .where(inArray(organizationDomains.organizationId, orgIds))
      : [];
  const domainsByOrg = new Map<string, Set<string>>();
  for (const r of orgDomainRows) {
    const set = domainsByOrg.get(r.organizationId) ?? new Set<string>();
    set.add(r.domain.toLowerCase());
    domainsByOrg.set(r.organizationId, set);
  }

  const t = await getTranslations("moderation");
  const tParticipants = await getTranslations("moderation.participants");
  const formatter = await getFormatter();

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </div>

      {held.length === 0 && pendingParticipants.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t("empty")}
          </CardContent>
        </Card>
      ) : null}

      {pendingParticipants.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">
            {tParticipants("heading", { count: pendingParticipants.length })}
          </h2>
          <ul className="space-y-3">
            {pendingParticipants.map((p) => (
              <li key={p.id}>
                <PendingParticipantCard
                  participant={{
                    id: p.id,
                    email: p.email,
                    name: p.name,
                    addedVia: p.addedVia,
                    requestedAt: formatter.dateTime(p.createdAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                    ticketId: p.ticketId,
                    ticketNumber: p.ticketNumber,
                    ticketSubject: p.ticketSubject,
                    ticketCustomerEmail: p.ticketCustomerEmail,
                    orgMatchStatus: p.orgMatchStatus,
                    domainMatchesTicketOrg: Boolean(
                      p.organizationId &&
                        domainsByOrg
                          .get(p.organizationId)
                          ?.has(emailDomain(p.email) ?? ""),
                    ),
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {held.length === 0 ? null : (
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
