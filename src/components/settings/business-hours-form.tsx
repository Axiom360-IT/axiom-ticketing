"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { updateSetting } from "@/app/actions/settings";
import { SaveRow } from "./save-button";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// Curated common time zones with friendly labels (EST / GMT / …). A FIXED list
// is important: the full `Intl.supportedValuesOf("timeZone")` differs between
// Node's and the browser's ICU, which caused an SSR/client hydration mismatch.
// Values are real IANA zones so daylight-saving is handled correctly (e.g.
// America/Toronto is EST in winter, EDT in summer). North America first since
// that's the primary audience; Eastern is the default.
const TIME_ZONES: { value: string; label: string }[] = [
  { value: "America/Toronto", label: "Eastern Time — EST / EDT (Toronto, New York)" },
  { value: "America/Chicago", label: "Central Time — CST / CDT (Chicago)" },
  { value: "America/Denver", label: "Mountain Time — MST / MDT (Denver)" },
  { value: "America/Phoenix", label: "Arizona — MST, no daylight saving (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific Time — PST / PDT (Los Angeles, Vancouver)" },
  { value: "America/Halifax", label: "Atlantic Time — AST / ADT (Halifax)" },
  { value: "America/St_Johns", label: "Newfoundland — NST / NDT (St. John's)" },
  { value: "UTC", label: "UTC (GMT)" },
  { value: "Europe/London", label: "London — GMT / BST" },
  { value: "Europe/Paris", label: "Central European — CET / CEST (Paris, Berlin)" },
  { value: "Europe/Athens", label: "Eastern European — EET / EEST (Athens)" },
  { value: "Asia/Dubai", label: "Gulf — GST (Dubai)" },
  { value: "Asia/Karachi", label: "Pakistan — PKT (Karachi)" },
  { value: "Asia/Kolkata", label: "India — IST (Kolkata, Mumbai)" },
  { value: "Asia/Singapore", label: "Singapore — SGT" },
  { value: "Asia/Tokyo", label: "Japan — JST (Tokyo)" },
  { value: "Australia/Sydney", label: "Australia Eastern — AEST / AEDT (Sydney)" },
];

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
  const { runWithReauth, gate } = useReauthGate();
  const t = useTranslations("settings.businessHours");
  const tDays = useTranslations("settings.days");

  const [timezone, setTimezone] = useState(initial.timezone);
  const [startHour, setStartHour] = useState(initial.startHour);
  const [endHour, setEndHour] = useState(initial.endHour);
  const [days, setDays] = useState<Set<string>>(new Set(initial.workingDays));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Live "now" in the selected zone so the admin can confirm the picker maps to
  // the time they expect. Client-only (set after mount) to avoid a hydration
  // mismatch on the changing clock; ticks every second.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    // Defer the first set into a timer (not a synchronous setState in the
    // effect body) — still paints within a frame, ticks every second after.
    const initial = setTimeout(update, 0);
    const id = setInterval(update, 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, []);

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
        const res = await runWithReauth(
          () => updateSetting(k, v),
          "settings",
        );
        if (!res.ok) {
          setError(res.error);
          return;
        }
      }
      setSaved(true);
      router.refresh();
    });
  }

  // Show the stored value even if it isn't one of the curated zones (so a zone
  // set previously, or via the DB, never silently disappears from the picker).
  const hasCurrent = TIME_ZONES.some((z) => z.value === timezone);

  // Render the live clock in the selected zone; `timeStyle: "long"` appends the
  // zone name (e.g. "…PM Eastern Daylight Time") for at-a-glance confirmation.
  const nowLabel = (() => {
    if (!now) return null;
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "long",
      }).format(now);
    } catch {
      return null;
    }
  })();

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="bh-tz">{t("timezone")}</Label>
          <select
            id="bh-tz"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            required
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-950"
          >
            {!hasCurrent ? <option value={timezone}>{timezone}</option> : null}
            {TIME_ZONES.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("timezoneHint")}
          </p>
          {nowLabel ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              {t("currentTime")}:{" "}
              <span className="font-medium tabular-nums">{nowLabel}</span>
            </p>
          ) : null}
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
      {gate}
    </form>
  );
}
