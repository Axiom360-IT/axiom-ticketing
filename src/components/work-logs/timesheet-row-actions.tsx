"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RowActionIcons } from "@/components/ui/row-actions";
import {
  WorkLogFields,
  type WorkLogFormValue,
  workLogMinutes,
} from "@/components/work-logs/work-log-fields";
import {
  deleteWorkLogEntry,
  updateWorkLogEntry,
} from "@/app/actions/work-logs";

type Entry = {
  id: string;
  description: string;
  minutes: number;
  serviceType: string;
  ticketNumber: string;
};

export function TimesheetRowActions({
  entry,
  canManage = true,
}: {
  entry: Entry;
  /** When false, the entry is read-only here (e.g. the ticket was reassigned
   *  away from this technician) — no edit/delete affordance is shown. */
  canManage?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("timesheet.rowActions");
  const tWorkLog = useTranslations("tickets.workLog");
  const tCommon = useTranslations("common");

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState<WorkLogFormValue>(() => ({
    description: entry.description,
    hours: String(Math.floor(entry.minutes / 60) || ""),
    minutes: String(entry.minutes % 60 || ""),
    serviceType: entry.serviceType,
  }));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resetForm() {
    setForm({
      description: entry.description,
      hours: String(Math.floor(entry.minutes / 60) || ""),
      minutes: String(entry.minutes % 60 || ""),
      serviceType: entry.serviceType,
    });
    setError(null);
  }

  function submitEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const mins = workLogMinutes(form);
    if (mins <= 0) {
      setError(tWorkLog("timeRequired"));
      return;
    }
    startTransition(async () => {
      const res = await updateWorkLogEntry(entry.id, {
        description: form.description.trim(),
        minutes: mins,
        serviceType: form.serviceType as "onsite" | "remote",
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditOpen(false);
      router.refresh();
    });
  }

  function submitDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteWorkLogEntry(entry.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDeleteOpen(false);
      router.refresh();
    });
  }

  // Read-only entry (ticket reassigned away) — no edit/delete affordance.
  if (!canManage) return null;

  return (
    <>
      <RowActionIcons
        ariaLabelPrefix={entry.ticketNumber}
        edit={() => {
          resetForm();
          setEditOpen(true);
        }}
        remove={{ onClick: () => setDeleteOpen(true) }}
      />

      {/* ── Edit entry ─────────────────────────────────────── */}
      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setError(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitEdit} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>
                {t("editTitle", { ticket: entry.ticketNumber })}
              </DialogTitle>
              <DialogDescription>{t("editDescription")}</DialogDescription>
            </DialogHeader>

            <WorkLogFields
              value={form}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              idPrefix={`wl-edit-${entry.id}`}
              disabled={pending}
            />

            {error ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={pending}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t("saving") : t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ─────────────────────────────────── */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setError(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDescription", { ticket: entry.ticketNumber })}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={pending}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={submitDelete}
              disabled={pending}
            >
              {pending ? t("deleting") : t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
