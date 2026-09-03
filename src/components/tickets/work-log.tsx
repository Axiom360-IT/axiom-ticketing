"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addWorkLogEntry,
  deleteWorkLogEntry,
} from "@/app/actions/work-logs";

export type WorkLogEntry = {
  id: string;
  description: string;
  minutes: number;
  serviceType: string;
  createdAt: Date;
  technicianId: string | null;
  technicianName: string | null;
};

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function WorkLog({
  ticketId,
  entries,
  canLog,
  currentUserId,
  viewerIsAssigned,
}: {
  ticketId: string;
  entries: WorkLogEntry[];
  canLog: boolean;
  /** The viewer's user id — only their OWN entries are deletable (frozen
   *  history, req 3.5/4.6). */
  currentUserId: string;
  /** Whether the viewer is the ticket's current primary or a co-assignee.
   *  Entries are frozen (read-only) once their author leaves the ticket, for
   *  every role — so delete only shows while the viewer is still assigned. */
  viewerIsAssigned: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("tickets.workLog");
  const format = useFormatter();

  const [description, setDescription] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, startDelete] = useTransition();

  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const totalMins =
      (parseInt(hours || "0", 10) || 0) * 60 +
      (parseInt(minutes || "0", 10) || 0);
    if (totalMins <= 0) {
      setError(t("timeRequired"));
      return;
    }
    setSubmitting(true);
    const res = await addWorkLogEntry(ticketId, {
      description: description.trim(),
      minutes: totalMins,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDescription("");
    setHours("");
    setMinutes("");
    router.refresh();
  }

  function handleDelete(id: string) {
    startDelete(async () => {
      await deleteWorkLogEntry(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {entries.length > 0 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">
            {t("totalLabel")}
          </span>
          <span className="font-medium">{formatMinutes(totalMinutes)}</span>
        </div>
      ) : null}

      <ul className="space-y-2">
        {entries.length === 0 ? (
          <li className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("empty")}
          </li>
        ) : (
          entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {entry.description}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {t("entryMeta", {
                      duration: formatMinutes(entry.minutes),
                      service:
                        entry.serviceType === "onsite"
                          ? t("serviceOnsite")
                          : entry.serviceType === "hybrid"
                            ? t("serviceHybrid")
                            : t("serviceRemote"),
                      technician: entry.technicianName ?? t("unknownTech"),
                      date: format.dateTime(entry.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    })}
                  </p>
                </div>
                {viewerIsAssigned && entry.technicianId === currentUserId ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    disabled={pendingDelete}
                    className="shrink-0 text-zinc-400 hover:text-red-600 disabled:opacity-50"
                    aria-label={t("deleteLabel")}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>

      {canLog ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="wl-description">{t("descriptionLabel")}</Label>
            <Textarea
              id="wl-description"
              required
              rows={2}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
            />
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wl-hours">{t("timeLabel")}</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="wl-hours"
                  type="number"
                  min={0}
                  max={24}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="w-14 text-center tabular-nums"
                  aria-label={t("hoursLabel")}
                />
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t("hoursShort")}
                </span>
                <Input
                  id="wl-minutes"
                  type="number"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className="w-14 text-center tabular-nums"
                  aria-label={t("minutesLabel")}
                />
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t("minutesShort")}
                </span>
              </div>
            </div>

            <Button type="submit" disabled={submitting}>
              {submitting ? t("adding") : t("addButton")}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
