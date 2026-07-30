"use client";

import { useState, useTransition } from "react";
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
import { setTicketPriority, setTicketStatus } from "@/app/actions/tickets";

// The in-flight statuses a technician can move a ticket between
// (Meeting-2, CR-13). Resolve/reopen keep their dedicated controls.
const WORKING_STATUSES = [
  "open",
  "in_progress",
  "awaiting_customer_confirmation",
  "on_hold",
] as const;
type WorkingStatus = (typeof WORKING_STATUSES)[number];

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
type Priority = (typeof PRIORITIES)[number];

/**
 * Status + priority in one panel with a single "Save changes" button. Replaces
 * the two auto-saving dropdowns so a technician can stage both and commit them
 * together (and never trip an accidental save just by opening a dropdown).
 * Only the fields that actually changed are written on save.
 */
export function TicketActionsControl({
  ticketId,
  currentStatus,
  currentPriority,
}: {
  ticketId: string;
  currentStatus: string;
  currentPriority: string;
}) {
  const router = useRouter();
  const tStatus = useTranslations("tickets.status");
  const tStatusCtl = useTranslations("tickets.statusControl");
  const tPriority = useTranslations("tickets.priority");
  const tPriorityCtl = useTranslations("tickets.priorityControl");
  const tForm = useTranslations("tickets.propertiesForm");

  const [status, setStatus] = useState(currentStatus);
  const [priority, setPriority] = useState(currentPriority);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = status !== currentStatus || priority !== currentPriority;

  function handleSave() {
    if (!dirty) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      // Write only the changed fields; stop on the first error so the user
      // sees exactly what failed.
      if (status !== currentStatus) {
        const res = await setTicketStatus(ticketId, status as WorkingStatus);
        if (!res.ok) {
          setError(res.error);
          return;
        }
      }
      if (priority !== currentPriority) {
        const res = await setTicketPriority(ticketId, priority as Priority);
        if (!res.ok) {
          setError(res.error);
          return;
        }
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <span className="block text-xs text-zinc-600 dark:text-zinc-400">
          {tStatusCtl("label")}
        </span>
        <Select
          items={Object.fromEntries(WORKING_STATUSES.map((s) => [s, tStatus(s)]))}
          value={status}
          onValueChange={(v) => {
            setStatus(v ?? status);
            setSaved(false);
            setError(null);
          }}
          disabled={pending}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WORKING_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {tStatus(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <span className="block text-xs text-zinc-600 dark:text-zinc-400">
          {tPriorityCtl("label")}
        </span>
        <Select
          items={Object.fromEntries(PRIORITIES.map((p) => [p, tPriority(p)]))}
          value={priority}
          onValueChange={(v) => {
            setPriority(v ?? priority);
            setSaved(false);
            setError(null);
          }}
          disabled={pending}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {tPriority(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={pending || !dirty}>
          {pending ? tForm("saving") : tForm("save")}
        </Button>
        {saved && !dirty ? (
          <span className="text-xs text-green-700 dark:text-green-400">
            {tForm("saved")}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
