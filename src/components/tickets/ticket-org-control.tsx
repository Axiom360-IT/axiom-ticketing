"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dismissTicketOrganization,
  linkTicketOrganization,
} from "@/app/actions/organizations";

const NO_ORG = "__none__";

type Org = { id: string; name: string };

/** Set or change the ticket's organization from the ticket page (coordinators+),
 *  mirroring the triage queue's link / "no organization" actions. */
export function TicketOrgControl({
  ticketId,
  currentOrganizationId,
  organizations,
}: {
  ticketId: string;
  currentOrganizationId: string | null;
  organizations: Org[];
}) {
  const router = useRouter();
  const t = useTranslations("tickets.orgControl");
  const [value, setValue] = useState(currentOrganizationId ?? NO_ORG);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // value → label so the trigger shows the org name, not the UUID.
  const items = {
    [NO_ORG]: t("noOrganization"),
    ...Object.fromEntries(organizations.map((o) => [o.id, o.name])),
  };

  function change(next: string | null) {
    const v = next ?? NO_ORG;
    if (v === value) return;
    const previous = value;
    setValue(v);
    setError(null);
    startTransition(async () => {
      const res =
        v === NO_ORG
          ? await dismissTicketOrganization(ticketId)
          : await linkTicketOrganization(ticketId, v);
      if (!res.ok) {
        setValue(previous);
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      <Select
        items={items}
        value={value}
        onValueChange={change}
        disabled={pending}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ORG}>{t("noOrganization")}</SelectItem>
          {organizations.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
