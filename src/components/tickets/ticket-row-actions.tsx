"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
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
  EscalatedBadge,
  PriorityBadge,
  StatusBadge,
} from "@/components/tickets/badges";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assignTicket, deleteTicket } from "@/app/actions/tickets";
import type { AssignableTechnician } from "@/lib/tickets/load";

type TicketSummary = {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  isEscalated: boolean;
  customerName: string;
  customerEmail: string;
  assignedToId: string | null;
  assignedToName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type Props = {
  ticket: TicketSummary;
  technicians: AssignableTechnician[];
  canAssign: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export function TicketRowActions({
  ticket,
  technicians,
  canAssign,
  canEdit,
  canDelete,
}: Props) {
  const t = useTranslations("common");
  const tDialog = useTranslations("tickets.rowActions");
  const tQueue = useTranslations("tickets.queue");
  const formatter = useFormatter();
  const router = useRouter();

  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [assignValue, setAssignValue] = useState<string>(
    ticket.assignedToId ?? "",
  );
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitEdit() {
    if (!assignValue || assignValue === ticket.assignedToId) {
      setEditOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await assignTicket(ticket.id, assignValue);
        setEditOpen(false);
        router.refresh();
      } catch (err) {
        // Never surface raw error messages — they can leak SQL, stack
        // info, or internals (e.g. Drizzle's "Failed query: select …").
        // The real cause is in the server logs.
        if (process.env.NODE_ENV !== "production") {
          console.error("[assignTicket] failed:", err);
        }
        setError(tDialog("genericError"));
      }
    });
  }

  function submitDelete() {
    if (confirmText !== ticket.ticketNumber) {
      setError(tDialog("deleteConfirmMismatch"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteTicket(ticket.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDeleteOpen(false);
      setConfirmText("");
      router.refresh();
    });
  }

  return (
    <>
      <RowActionIcons
        ariaLabelPrefix={ticket.ticketNumber}
        view={() => setViewOpen(true)}
        edit={canEdit && canAssign && technicians.length > 0
          ? () => setEditOpen(true)
          : undefined}
        remove={canDelete ? { onClick: () => setDeleteOpen(true) } : undefined}
      />

      {/* ── View modal ─────────────────────────────────────── */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-blue-600 dark:text-blue-400">
                {ticket.ticketNumber}
              </span>
              {ticket.isEscalated ? <EscalatedBadge /> : null}
            </DialogTitle>
            <DialogDescription className="text-foreground text-sm leading-snug">
              {ticket.subject}
            </DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tQueue("columns.status")}
            </dt>
            <dd>
              <StatusBadge status={ticket.status} />
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tQueue("columns.priority")}
            </dt>
            <dd>
              <PriorityBadge priority={ticket.priority} />
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tQueue("columns.customer")}
            </dt>
            <dd className="min-w-0">
              <div>{ticket.customerName}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 break-all">
                {ticket.customerEmail}
              </div>
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tQueue("columns.assignee")}
            </dt>
            <dd>
              {ticket.assignedToName ?? (
                <span className="text-zinc-400">{tQueue("unassigned")}</span>
              )}
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tDialog("createdLabel")}
            </dt>
            <dd className="text-zinc-600 dark:text-zinc-300">
              {formatter.dateTime(ticket.createdAt, { dateStyle: "medium" })}
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tDialog("updatedLabel")}
            </dt>
            <dd className="text-zinc-600 dark:text-zinc-300">
              {formatter.dateTime(ticket.updatedAt, { dateStyle: "medium" })}
            </dd>
          </dl>

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOpen(false)}>
              {t("close")}
            </Button>
            <Button
              nativeButton={false}
              render={<Link href={`/admin/tickets/${ticket.id}`} />}
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              {tDialog("openFullTicket")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit modal (assignee change; richer edits live on detail page) ── */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tDialog("editTitle", { ticket: ticket.ticketNumber })}
            </DialogTitle>
            <DialogDescription>{tDialog("editDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-zinc-600 dark:text-zinc-400">
              {tQueue("columns.assignee")}
            </label>
            <Select
              value={assignValue}
              onValueChange={(v) => setAssignValue(v ?? "")}
              disabled={pending}
            >
              <SelectTrigger>
                {/* Base UI's SelectValue does NOT mirror SelectItem text —
                    without this map it renders the raw UUID. */}
                <SelectValue placeholder={tDialog("selectTechnician")}>
                  {(v: string | null) =>
                    v ? technicians.find((t) => t.id === v)?.name ?? v : ""
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {technicians.map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error && editOpen ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}
            <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-2">
              {tDialog("editHint")}
              {" "}
              <Link
                href={`/admin/tickets/${ticket.id}`}
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {tDialog("openFullTicket")}
              </Link>
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={submitEdit}
              disabled={
                pending || !assignValue || assignValue === ticket.assignedToId
              }
            >
              {pending ? tDialog("assigning") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm modal (typed confirmation) ─────── */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setConfirmText("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tDialog("deleteTitle", { ticket: ticket.ticketNumber })}
            </DialogTitle>
            <DialogDescription>
              {tDialog("deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-zinc-600 dark:text-zinc-400">
              {t("typeToConfirm", { value: ticket.ticketNumber })}
            </label>
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={pending}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder={ticket.ticketNumber}
            />
            {error && deleteOpen ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={submitDelete}
              disabled={pending || confirmText !== ticket.ticketNumber}
            >
              {pending ? tDialog("deleting") : t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
