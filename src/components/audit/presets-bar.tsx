"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  createAuditFilterPreset,
  deleteAuditFilterPreset,
  type AuditFilterPreset,
} from "@/app/actions/audit-presets";

export function AuditPresetsBar({ presets }: { presets: AuditFilterPreset[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("audit.presets");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Strip paging state — a preset reproduces the FILTER, not whichever page
  // number someone happened to be on when they saved it.
  const currentQueryString = (() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("page");
    p.delete("pageSize");
    return p.toString();
  })();
  const activePreset = presets.find((p) => p.queryString === currentQueryString);

  function handleSelect(id: string) {
    if (!id) {
      router.push("/admin/audit");
      return;
    }
    const preset = presets.find((p) => p.id === id);
    if (preset) {
      router.push(preset.queryString ? `/admin/audit?${preset.queryString}` : "/admin/audit");
    }
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createAuditFilterPreset({
        name,
        queryString: currentQueryString,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDialogOpen(false);
      setName("");
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteAuditFilterPreset(id);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="audit-preset-select" className="text-xs text-zinc-500 dark:text-zinc-400">
        {t("label")}
      </Label>
      <select
        id="audit-preset-select"
        value={activePreset?.id ?? ""}
        onChange={(e) => handleSelect(e.target.value)}
        className="h-8 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-sm"
      >
        <option value="">{t("none")}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {activePreset ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => handleDelete(activePreset.id)}
          disabled={isPending}
          aria-label={t("delete")}
          title={t("delete")}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger
          render={
            <Button type="button" variant="outline" size="sm" disabled={!currentQueryString}>
              {t("saveButton")}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>{t("saveTitle")}</DialogTitle>
              <DialogDescription>{t("saveDescription")}</DialogDescription>
            </DialogHeader>
            <div className="py-3 space-y-1.5">
              <Label htmlFor="audit-preset-name">{t("nameLabel")}</Label>
              <Input
                id="audit-preset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                autoFocus
              />
              {error ? (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              ) : null}
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t("cancel")}
              </DialogClose>
              <Button type="submit" disabled={isPending || !name.trim()}>
                {isPending ? t("saving") : t("saveButton")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
