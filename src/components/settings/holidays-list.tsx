"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addHoliday, removeHoliday } from "@/app/actions/settings";

type Props = {
  initial: { date: string; label: string }[];
};

export function HolidaysList({ initial }: Props) {
  const router = useRouter();
  const t = useTranslations("settings.holidays");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);

  function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!date || !label.trim()) return;
    startTransition(async () => {
      const res = await addHoliday(date, label.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDate("");
      setLabel("");
      router.refresh();
    });
  }

  function handleRemove(d: string) {
    setError(null);
    setRemoving(d);
    startTransition(async () => {
      const res = await removeHoliday(d);
      setRemoving(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("addDate")}
          </label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5 flex-1 min-w-[12rem]">
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("addLabel")}
          </label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            required
          />
        </div>
        <Button type="submit" disabled={isPending} variant="outline">
          {t("addButton")}
        </Button>
      </form>

      {initial.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {initial.map((h) => (
            <li
              key={h.date}
              className="flex items-center gap-3 px-2 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-sm"
            >
              <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 w-28">
                {h.date}
              </span>
              <span className="flex-1 min-w-0 break-words">{h.label}</span>
              <button
                type="button"
                onClick={() => handleRemove(h.date)}
                disabled={removing === h.date}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-red-600"
                aria-label={t("remove")}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
