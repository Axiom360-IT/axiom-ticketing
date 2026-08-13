"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TicketTypeIconPicker } from "@/components/settings/ticket-type-icon-picker";
import { createCategory } from "@/app/actions/categories";
import { createType } from "@/app/actions/ticket-types";
import {
  suggestTicketTypeIcon,
  type TicketTypeIconKey,
} from "@/lib/tickets/type-icon-keys";

type Result = { ok: true } | { ok: false; error: string };

const CREATE: Record<
  "category" | "type",
  (label: string, icon?: string) => Promise<Result>
> = {
  category: createCategory,
  type: createType,
};

export function AddTaxonomyButton({
  kind,
  namespace,
}: {
  kind: "category" | "type";
  namespace: string;
}) {
  const t = useTranslations(namespace);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  // Icon only applies to `type`. Stays null until the admin explicitly picks
  // one — until then, effectiveIcon below live-suggests from the label on
  // every keystroke.
  const [touchedIcon, setTouchedIcon] = useState<TicketTypeIconKey | null>(
    null,
  );
  const effectiveIcon = touchedIcon ?? suggestTicketTypeIcon(label);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const clean = label.trim();
    if (!clean) return;
    setError(null);
    start(async () => {
      const res = await CREATE[kind](
        clean,
        kind === "type" ? effectiveIcon : undefined,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLabel("");
      setTouchedIcon(null);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" aria-hidden="true" />
            {t("add")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("addTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          {kind === "type" ? (
            <TicketTypeIconPicker
              value={effectiveIcon}
              onChange={setTouchedIcon}
              label={t("iconLabel")}
            />
          ) : null}
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("addPlaceholder")}
            maxLength={40}
            aria-label={t("addLabel")}
            autoFocus
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose
            render={<Button variant="outline">{t("cancel")}</Button>}
          />
          <Button disabled={pending || !label.trim()} onClick={submit}>
            {t("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
