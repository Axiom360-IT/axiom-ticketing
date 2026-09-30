"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ParticipantPanelRow } from "@/lib/tickets/participants";
import {
  addTicketParticipant,
  removeTicketParticipant,
} from "@/app/actions/participants";
import {
  guestAddParticipant,
  listMyOrgColleaguesAction,
} from "@/app/actions/customer-portal";

/**
 * Everyone on a ticket's thread, in one list — the requester, anyone added by
 * a colleague or staff member, addresses picked up from an inbound To/CC, and
 * the organization's trusted contacts.
 *
 * Shared by the admin sidebar and the customer/guest portal, which differ in
 * `mode`: staff add by typing an address (they ARE the approval gate), while
 * a customer picks a colleague from their own organization — never a free
 * address, since that is the guest-request path and needs approval.
 */

export type PanelRequester = { email: string; name: string | null };

type Props = {
  ticketId: string;
  requester: PanelRequester;
  rows: ParticipantPanelRow[];
  mode: "admin" | "portal";
  /** Staff who can act on the ticket, or the customer who raised it. */
  canManage?: boolean;
  /** Present only on the guest surface — there is no session there, so writes
   *  go through the token-authorized action instead. */
  guestToken?: string;
  /** Guest surface needs the number, not the id, to re-verify the token. */
  ticketNumber?: string;
};

function badgeClass(tone: "neutral" | "pending" | "removed" | "trusted"): string {
  return cn(
    "shrink-0 rounded px-1.5 py-px text-[10px] font-medium",
    tone === "pending" &&
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    tone === "removed" &&
      "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
    tone === "trusted" &&
      "bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
    tone === "neutral" &&
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  );
}

export function ParticipantsPanel({
  ticketId,
  requester,
  rows,
  mode,
  canManage = false,
  guestToken,
  ticketNumber,
}: Props) {
  const router = useRouter();
  const t = useTranslations("tickets.participants");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [colleagueId, setColleagueId] = useState("");
  const [colleagues, setColleagues] = useState<
    { id: string; name: string }[] | null
  >(null);

  // Loaded lazily on open — the picker is a query per ticket page otherwise.
  function openAdd() {
    setAdding(true);
    setError(null);
    if (mode === "portal" && colleagues === null) {
      startTransition(async () => {
        const res = await listMyOrgColleaguesAction();
        setColleagues(res.ok ? res.colleagues : []);
        if (!res.ok) setError(res.error);
      });
    }
  }

  function submitAdd() {
    setError(null);
    startTransition(async () => {
      // A guest has no session — their request goes through the token-
      // authorized action and always lands as pending.
      const res = guestToken && ticketNumber
        ? await guestAddParticipant({
            ticketNumber,
            token: guestToken,
            email: email.trim(),
          })
        : await addTicketParticipant(
            mode === "portal"
              ? { ticketId, colleagueUserId: colleagueId }
              : { ticketId, email: email.trim() },
          );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEmail("");
      setColleagueId("");
      setAdding(false);
      router.refresh();
    });
  }

  function remove(participantId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeTicketParticipant({ ticketId, participantId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  // Removed rows are history, not participants — they stay out of the list
  // until there's a UI that can re-add them.
  const visible = rows.filter(
    (r) => r.kind === "org_trusted" || r.status !== "removed",
  );

  function provenance(row: ParticipantPanelRow): {
    label: string;
    tone: "neutral" | "pending" | "removed" | "trusted";
  } {
    if (row.kind === "org_trusted") {
      return {
        label: row.organizationName
          ? t("trustedForOrg", { org: row.organizationName })
          : t("trusted"),
        tone: "trusted",
      };
    }
    if (row.status === "pending") return { label: t("pending"), tone: "pending" };
    switch (row.addedVia) {
      case "domain_auto":
        return { label: t("autoJoined"), tone: "neutral" };
      case "moderation":
        return { label: t("approved"), tone: "neutral" };
      default:
        return {
          label: row.addedByName
            ? t("addedBy", { name: row.addedByName })
            : t("added"),
          tone: "neutral",
        };
    }
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {/* The requester is synthesized from the ticket itself — they have no
            participant row and can never be removed. */}
        <li className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {requester.name || requester.email}
            </span>
            {requester.name ? (
              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                {requester.email}
              </span>
            ) : null}
          </span>
          <span className={badgeClass("neutral")}>{t("requester")}</span>
        </li>

        {visible.map((row) => {
          const { label, tone } = provenance(row);
          return (
            <li
              key={row.kind === "participant" ? row.id : `trusted:${row.email}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {row.name || row.email}
                </span>
                {row.name ? (
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {row.email}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className={badgeClass(tone)}>{label}</span>
                {canManage && !guestToken && row.kind === "participant" ? (
                  <button
                    type="button"
                    onClick={() => remove(row.id)}
                    disabled={pending}
                    aria-label={t("removeLabel", { email: row.email })}
                    className="text-zinc-400 hover:text-red-600 disabled:opacity-50"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {canManage ? (
        adding ? (
          <div className="space-y-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
            {mode === "portal" && !guestToken ? (
              colleagues && colleagues.length > 0 ? (
                <Select
                  items={Object.fromEntries(
                    colleagues.map((c) => [c.id, c.name]),
                  )}
                  value={colleagueId}
                  onValueChange={(v) => setColleagueId(v ?? "")}
                  disabled={pending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("pickColleague")} />
                  </SelectTrigger>
                  <SelectContent>
                    {colleagues.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {colleagues === null ? t("loading") : t("noColleagues")}
                </p>
              )
            ) : (
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                disabled={pending}
              />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={submitAdd}
                disabled={
                  pending ||
                  (mode === "portal" && !guestToken
                    ? !colleagueId
                    : email.trim().length === 0)
                }
              >
                {t("addButton")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAdding(false)}
                disabled={pending}
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-1 text-xs text-blue-700 hover:underline dark:text-blue-400"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t("addPerson")}
          </button>
        )
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {mode === "admin" ? t("emptyAdmin") : t("emptyPortal")}
        </p>
      ) : null}
    </div>
  );
}
