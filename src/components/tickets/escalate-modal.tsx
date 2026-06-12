"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  deescalateTicket,
  escalateTicket,
} from "@/app/actions/tickets";

const ESCALATION_REASONS = [
  "beyond_scope",
  "requires_access",
  "critical_impact",
  "vendor_involvement",
  "other",
] as const;
type EscalationReason = (typeof ESCALATION_REASONS)[number];

// Upper-hierarchy roles a technician can escalate to (Meeting-2, CR-14).
// Overridable so a deployment with extra elevated roles (e.g. "CTO") can
// pass its own list from the server.
const DEFAULT_ESCALATION_TARGETS = ["Coordinator", "IT Director", "Super Admin"];

type EscalateModalProps = {
  ticketId: string;
  isEscalated: boolean;
  canDeescalate: boolean;
  escalationTargets?: string[];
};

export function EscalateModal({
  ticketId,
  isEscalated,
  canDeescalate,
  escalationTargets = DEFAULT_ESCALATION_TARGETS,
}: EscalateModalProps) {
  const router = useRouter();
  const tModal = useTranslations("tickets.escalateModal");
  const tReason = useTranslations("tickets.escalationReason");
  const tActions = useTranslations("tickets.actions");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<EscalationReason | "">("");
  const [targetRole, setTargetRole] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleEscalate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!reason) {
      setError(tModal("reasonRequired"));
      return;
    }
    if (!targetRole) {
      setError(tModal("targetRoleRequired"));
      return;
    }
    startTransition(async () => {
      try {
        await escalateTicket(
          ticketId,
          reason,
          note.trim() || undefined,
          targetRole,
        );
        setReason("");
        setTargetRole("");
        setNote("");
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : tModal("escalateError"));
      }
    });
  }

  function handleDeescalate() {
    setError(null);
    startTransition(async () => {
      try {
        await deescalateTicket(ticketId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : tModal("deescalateError"));
      }
    });
  }

  if (isEscalated) {
    if (!canDeescalate) return null;
    return (
      <Button variant="outline" onClick={handleDeescalate} disabled={isPending}>
        {isPending ? tActions("deescalatePending") : tActions("deescalate")}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="outline">{tActions("escalate")}</Button>}
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleEscalate} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{tModal("escalateTitle")}</DialogTitle>
            <DialogDescription>
              {tModal("escalateDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-600 dark:text-zinc-400">
              {tModal("reasonLabel")}
            </label>
            <Select
              items={Object.fromEntries(
                ESCALATION_REASONS.map((r) => [r, tReason(r)]),
              )}
              value={reason}
              onValueChange={(v) => setReason((v ?? "") as EscalationReason | "")}
              disabled={isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={tModal("reasonPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {ESCALATION_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {tReason(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-600 dark:text-zinc-400">
              {tModal("targetRoleLabel")}
            </label>
            <Select
              value={targetRole}
              onValueChange={(v) => setTargetRole(v ?? "")}
              disabled={isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={tModal("targetRolePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {escalationTargets.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-600 dark:text-zinc-400">
              {tModal("noteLabel")}
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={tModal("notePlaceholder")}
              maxLength={1000}
              disabled={isPending}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {note.length}/1000
            </p>
          </div>

          {error ? (
            <div
              role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
            >
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {tCommon("cancel")}
            </DialogClose>
            <Button type="submit" disabled={isPending || !reason || !targetRole}>
              {isPending ? tActions("escalatePending") : tActions("escalate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
