"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EMPTY_WORK_LOG,
  WorkLogFields,
  type WorkLogFormValue,
  workLogMinutes,
} from "@/components/work-logs/work-log-fields";
import { addWorkLogEntry } from "@/app/actions/work-logs";

type LoggableTicket = { id: string; ticketNumber: string; subject: string };

export function AddTimeModal({ tickets }: { tickets: LoggableTicket[] }) {
  const router = useRouter();
  const t = useTranslations("timesheet.addModal");
  const tWorkLog = useTranslations("tickets.workLog");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [ticketId, setTicketId] = useState("");
  const [form, setForm] = useState<WorkLogFormValue>(EMPTY_WORK_LOG);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // value → "AX-0042 · Subject" so the trigger shows a label, not the UUID.
  const ticketLabels = Object.fromEntries(
    tickets.map((tk) => [tk.id, `${tk.ticketNumber} · ${tk.subject}`]),
  );

  function reset() {
    setTicketId("");
    setForm(EMPTY_WORK_LOG);
    setError(null);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!ticketId) {
      setError(t("ticketRequired"));
      return;
    }
    const mins = workLogMinutes(form);
    if (mins <= 0) {
      setError(tWorkLog("timeRequired"));
      return;
    }
    startTransition(async () => {
      const res = await addWorkLogEntry(ticketId, {
        description: form.description.trim(),
        minutes: mins,
        serviceType: form.serviceType as "onsite" | "remote",
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("trigger")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          {tickets.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t("noTickets")}
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="wl-ticket">{t("ticketLabel")}</Label>
                <Select
                  items={ticketLabels}
                  value={ticketId}
                  onValueChange={(v) => setTicketId(v ?? "")}
                  disabled={pending}
                >
                  <SelectTrigger id="wl-ticket" className="w-full">
                    <SelectValue placeholder={t("ticketPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {tickets.map((tk) => (
                      <SelectItem key={tk.id} value={tk.id}>
                        {tk.ticketNumber} · {tk.subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <WorkLogFields
                value={form}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
                idPrefix="wl-add"
                disabled={pending}
              />
            </>
          )}

          {error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending || tickets.length === 0}>
              {pending ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
