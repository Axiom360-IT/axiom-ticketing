"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSetting } from "@/app/actions/settings";
import { SaveRow } from "./save-button";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type Props = {
  initial: {
    timezone: string;
    startHour: number;
    endHour: number;
    workingDays: string[];
  };
};

export function BusinessHoursForm({ initial }: Props) {
  const router = useRouter();
  const t = useTranslations("settings.businessHours");
  const tDays = useTranslations("settings.days");

  const [timezone, setTimezone] = useState(initial.timezone);
  const [startHour, setStartHour] = useState(initial.startHour);
  const [endHour, setEndHour] = useState(initial.endHour);
  const [days, setDays] = useState<Set<string>>(new Set(initial.workingDays));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function toggle(day: string) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const writes: [string, unknown][] = [
        ["business_hours.timezone", timezone],
        ["business_hours.start_hour", startHour],
        ["business_hours.end_hour", endHour],
        ["business_hours.working_days", DAYS.filter((d) => days.has(d))],
      ];
      for (const [k, v] of writes) {
        const res = await updateSetting(k, v);
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
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="bh-tz">{t("timezone")}</Label>
          <Input
            id="bh-tz"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            maxLength={64}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bh-start">{t("startHour")}</Label>
          <Input
            id="bh-start"
            type="number"
            min={0}
            max={23}
            value={startHour}
            onChange={(e) => setStartHour(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bh-end">{t("endHour")}</Label>
          <Input
            id="bh-end"
            type="number"
            min={1}
            max={24}
            value={endHour}
            onChange={(e) => setEndHour(Number(e.target.value))}
          />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("workingDays")}</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const on = days.has(d);
            return (
              <button
                type="button"
                key={d}
                onClick={() => toggle(d)}
                className={`px-3 py-1.5 rounded-full border text-sm ${
                  on
                    ? "bg-blue-600 text-white border-blue-700"
                    : "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
                }`}
                aria-pressed={on}
              >
                {tDays(d as (typeof DAYS)[number])}
              </button>
            );
          })}
        </div>
      </fieldset>
      <SaveRow pending={isPending} saved={saved} error={error} />
    </form>
  );
}
