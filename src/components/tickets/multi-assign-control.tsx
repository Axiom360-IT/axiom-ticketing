"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addTicketCollaborator,
  removeTicketCollaborator,
} from "@/app/actions/ticket-assignees";

type Person = { id: string; name: string };

export function MultiAssignControl({
  ticketId,
  collaborators,
  candidates,
}: {
  ticketId: string;
  collaborators: Person[];
  candidates: Person[];
}) {
  const router = useRouter();
  const t = useTranslations("tickets.multiAssign");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add(userId: string) {
    if (!userId) return;
    setError(null);
    startTransition(async () => {
      const res = await addTicketCollaborator(ticketId, userId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function remove(userId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeTicketCollaborator(ticketId, userId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {collaborators.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {collaborators.map((c) => (
            <li
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 pl-2.5 pr-1 py-0.5 text-xs"
            >
              <span>{c.name}</span>
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={pending}
                className="rounded-full p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50"
                aria-label={t("removeLabel", { name: c.name })}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
      )}

      {candidates.length > 0 ? (
        <Select value="" onValueChange={(v) => add(v ?? "")} disabled={pending}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("addPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
