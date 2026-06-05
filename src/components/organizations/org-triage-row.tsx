"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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

type Org = { id: string; name: string };

/** Per-row triage control: pick an existing org to link the ticket to, or jump
 *  to the create form prefilled with the claimed company name. */
export function OrgTriageRow({
  ticketId,
  claimedCompany,
  organizations,
}: {
  ticketId: string;
  claimedCompany: string | null;
  organizations: Org[];
}) {
  const router = useRouter();
  const t = useTranslations("orgTriage");
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const items = Object.fromEntries(organizations.map((o) => [o.id, o.name]));
  const createHref = claimedCompany
    ? `/admin/organizations/new?name=${encodeURIComponent(claimedCompany)}`
    : "/admin/organizations/new";

  function link() {
    if (!orgId) return;
    setError(null);
    startTransition(async () => {
      const res = await linkTicketOrganization(ticketId, orgId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function dismiss() {
    setError(null);
    startTransition(async () => {
      const res = await dismissTicketOrganization(ticketId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        items={items}
        value={orgId}
        onValueChange={(v) => setOrgId(v ?? "")}
        disabled={pending}
      >
        <SelectTrigger className="h-8 w-52">
          <SelectValue placeholder={t("selectOrg")} />
        </SelectTrigger>
        <SelectContent>
          {organizations.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" className="min-h-[36px]" onClick={link} disabled={pending || !orgId}>
        {pending ? t("linking") : t("link")}
      </Button>
      <Button
        size="sm"
        className="min-h-[36px]"
        variant="ghost"
        nativeButton={false}
        render={<Link href={createHref} />}
      >
        {t("createNew")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={dismiss}
        disabled={pending}
        className="min-h-[36px] text-zinc-500"
      >
        {t("dismiss")}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : null}
    </div>
  );
}
