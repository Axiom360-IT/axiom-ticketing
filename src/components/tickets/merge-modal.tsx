"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  type MergeCandidate,
  listMergeCandidates,
  mergeTickets,
} from "@/app/actions/tickets";

type Props = {
  ticketId: string;
  sourceTicketNumber: string;
};

export function MergeModal({ ticketId, sourceTicketNumber }: Props) {
  const router = useRouter();
  const t = useTranslations("tickets.actions");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<MergeCandidate[]>([]);
  const [selected, setSelected] = useState<MergeCandidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Debounced same-org candidate search (req 4.2/4.3). Runs while open,
  // including the empty query (shows the most recent same-org tickets).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await listMergeCandidates(ticketId, query);
        if (!cancelled) {
          setCandidates(rows);
          // Drop a prior selection that's no longer in the list, so Confirm
          // can't act on a candidate the user can no longer see.
          setSelected((prev) =>
            prev && rows.some((r) => r.id === prev.id) ? prev : null,
          );
        }
      } catch {
        if (!cancelled) {
          setCandidates([]);
          setSelected(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, ticketId]);

  function reset() {
    setQuery("");
    setCandidates([]);
    setSelected(null);
    setError(null);
  }

  function handleSubmit() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const res = await mergeTickets(ticketId, selected.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {t("merge")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("mergeTitle", { source: sourceTicketNumber })}
            </DialogTitle>
            <DialogDescription>
              {t("mergeDescription", { source: sourceTicketNumber })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("mergeSearchPlaceholder")}
                disabled={pending}
                className="pl-8"
                aria-label={t("mergeSearchPlaceholder")}
              />
            </div>

            <ul className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading && candidates.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-zinc-400">
                  {t("mergeSearching")}
                </li>
              ) : candidates.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-zinc-400">
                  {t("mergeNoResults")}
                </li>
              ) : (
                candidates.map((c) => {
                  const isSelected = selected?.id === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(c)}
                        disabled={pending}
                        className={cn(
                          "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50",
                          isSelected && "bg-blue-50 dark:bg-blue-950/40",
                        )}
                      >
                        <Check
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            isSelected
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-transparent",
                          )}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                            {c.ticketNumber}
                          </span>
                          <span className="block truncate font-medium">
                            {c.subject}
                          </span>
                          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {c.customerName}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            {error ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleSubmit}
              disabled={pending || !selected}
            >
              {pending ? t("mergePending") : t("mergeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
