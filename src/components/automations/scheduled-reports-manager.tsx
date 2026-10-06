"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import {
  createScheduledReport,
  deleteScheduledReport,
  type ScheduledReportInput,
  type ScheduledReportListRow,
  sendScheduledReportNow,
  setScheduledReportEnabled,
  updateScheduledReport,
} from "@/app/actions/scheduled-reports";
import type { ReportFailure } from "@/lib/automations/reports";
import { isDescribedSendFailure } from "@/lib/email/send-failure-causes";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type Props = {
  reports: ScheduledReportListRow[];
  staff: { id: string; name: string; email: string }[];
  roleNames: string[];
  timezone: string;
};

type Draft = {
  id: string | null;
  name: string;
  rangeDays: number;
  format: "xlsx" | "csv" | "pdf";
  hour: number;
  minute: number;
  weekdays: string[];
  recipientUserIds: string[];
  recipientRoles: string[];
  recipientEmails: string[];
};

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  rangeDays: 1,
  format: "xlsx",
  hour: 19,
  minute: 0,
  weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  recipientUserIds: [],
  recipientRoles: [],
  recipientEmails: [],
});

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const draftFrom = (r: ScheduledReportListRow): Draft => ({
  id: r.id,
  name: r.name,
  rangeDays: r.rangeDays,
  format: (["xlsx", "csv", "pdf"] as const).includes(
    r.format as "xlsx" | "csv" | "pdf",
  )
    ? (r.format as "xlsx" | "csv" | "pdf")
    : "xlsx",
  hour: r.hour,
  minute: r.minute,
  weekdays: asStrings(r.weekdays),
  recipientUserIds: asStrings(r.recipientUserIds),
  recipientRoles: asStrings(r.recipientRoles),
  recipientEmails: asStrings(r.recipientEmails),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pad = (n: number) => String(n).padStart(2, "0");

export function ScheduledReportsManager({
  reports,
  staff,
  roleNames,
  timezone,
}: Props) {
  const router = useRouter();
  const t = useTranslations("automations.reports");
  const { runWithReauth, gate } = useReauthGate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  function save() {
    if (!draft) return;
    setError(null);
    setNotice(null);
    const payload: ScheduledReportInput = {
      name: draft.name.trim(),
      report: "management",
      rangeDays: draft.rangeDays,
      format: draft.format,
      hour: draft.hour,
      minute: draft.minute,
      weekdays: draft.weekdays as ScheduledReportInput["weekdays"],
      recipientUserIds: draft.recipientUserIds,
      recipientRoles: draft.recipientRoles,
      recipientEmails: draft.recipientEmails,
    };
    startTransition(async () => {
      const id = draft.id;
      const res = await runWithReauth(
        () =>
          id
            ? updateScheduledReport(id, payload)
            : createScheduledReport(payload),
        "settings",
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await runWithReauth(
        () => deleteScheduledReport(id),
        "settings",
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function togglePause(id: string, next: boolean) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await setScheduledReportEnabled(id, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function sendNow(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await sendScheduledReportNow(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.failed.length > 0) {
        setError(describeFailures(res, t));
      } else {
        setNotice(t("sentOk", { delivered: res.delivered }));
      }
      router.refresh();
    });
  }

  function toggleIn(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t("heading")}</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("subtitle", { timezone })}
          </p>
        </div>
        {draft === null ? (
          <Button size="sm" onClick={() => setDraft(emptyDraft())}>
            <Plus className="size-4" aria-hidden="true" />
            {t("add")}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      ) : null}

      {/* ── Existing schedules ─────────────────────────────────────── */}
      {reports.length === 0 && draft === null ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {t("empty")}
        </p>
      ) : null}

      <ul className="space-y-2">
        {reports.map((r) => {
          const recipients =
            asStrings(r.recipientRoles).length +
            asStrings(r.recipientUserIds).length +
            asStrings(r.recipientEmails).length;
          return (
            <li
              key={r.id}
              className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {r.name}
                    {!r.enabled ? (
                      <span className="rounded bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {t("paused")}
                      </span>
                    ) : null}
                    {r.lastStatus === "error" ? (
                      <span className="rounded bg-red-100 px-1.5 py-px text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300">
                        {t("lastFailed")}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                    {t("summary", {
                      time: `${pad(r.hour)}:${pad(r.minute)}`,
                      days: asStrings(r.weekdays).join(", ") || "—",
                      recipients,
                    })}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {r.lastRunOn
                      ? t("lastSent", { date: r.lastRunOn })
                      : t("neverSent")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => sendNow(r.id)}
                  >
                    <Send className="size-3.5" aria-hidden="true" />
                    {t("sendNow")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => togglePause(r.id, !r.enabled)}
                  >
                    {r.enabled ? t("pause") : t("resume")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => setDraft(draftFrom(r))}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    {t("edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => remove(r.id)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    {t("delete")}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* ── Create / edit ──────────────────────────────────────────── */}
      {draft ? (
        <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900 dark:bg-blue-950/20">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {draft.id ? t("editHeading") : t("addHeading")}
            </h3>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
              <X className="size-3.5" aria-hidden="true" />
              {t("cancel")}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sr-name">{t("fieldName")}</Label>
              <Input
                id="sr-name"
                value={draft.name}
                placeholder={t("namePlaceholder")}
                onChange={(e) =>
                  setDraft({ ...draft, name: e.target.value })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sr-time">{t("fieldTime", { timezone })}</Label>
              <Input
                id="sr-time"
                type="time"
                value={`${pad(draft.hour)}:${pad(draft.minute)}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":");
                  setDraft({
                    ...draft,
                    hour: Number(h) || 0,
                    minute: Number(m) || 0,
                  });
                }}
              />
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {t("timeHint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sr-range">{t("fieldRange")}</Label>
              <Input
                id="sr-range"
                type="number"
                min={1}
                max={365}
                value={draft.rangeDays}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    rangeDays: Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sr-format">{t("fieldFormat")}</Label>
              <Select
                value={draft.format}
                onValueChange={(v) =>
                  setDraft({ ...draft, format: v as Draft["format"] })
                }
              >
                <SelectTrigger id="sr-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xlsx">{t("formatXlsx")}</SelectItem>
                  <SelectItem value="pdf">{t("formatPdf")}</SelectItem>
                  <SelectItem value="csv">{t("formatCsv")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("fieldDays")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={draft.weekdays.includes(d)}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      weekdays: toggleIn(draft.weekdays, d),
                    })
                  }
                  className={cn(
                    "rounded border px-2 py-1 text-xs transition-colors",
                    draft.weekdays.includes(d)
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("fieldRoles")}</Label>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {t("rolesHint")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {roleNames.map((role) => (
                <button
                  key={role}
                  type="button"
                  aria-pressed={draft.recipientRoles.includes(role)}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      recipientRoles: toggleIn(draft.recipientRoles, role),
                    })
                  }
                  className={cn(
                    "rounded border px-2 py-1 text-xs transition-colors",
                    draft.recipientRoles.includes(role)
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
                  )}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sr-person">{t("fieldPeople")}</Label>
            <Select
              value=""
              onValueChange={(id) => {
                // The Select reports null when it clears; only a real id adds
                // a recipient.
                if (!id) return;
                setDraft({
                  ...draft,
                  recipientUserIds: toggleIn(draft.recipientUserIds, id),
                });
              }}
            >
              <SelectTrigger id="sr-person">
                <SelectValue placeholder={t("peoplePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.recipientUserIds.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {draft.recipientUserIds.map((id) => {
                  const person = staff.find((s) => s.id === id);
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800"
                    >
                      {person?.name ?? id}
                      <button
                        type="button"
                        aria-label={t("removeRecipient")}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            recipientUserIds: draft.recipientUserIds.filter(
                              (u) => u !== id,
                            ),
                          })
                        }
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sr-email">{t("fieldEmails")}</Label>
            <div className="flex gap-2">
              <Input
                id="sr-email"
                type="email"
                value={emailDraft}
                placeholder={t("emailPlaceholder")}
                onChange={(e) => {
                  setEmailDraft(e.target.value);
                  setError(null);
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const email = emailDraft.trim().toLowerCase();
                  if (!EMAIL_RE.test(email)) {
                    setError(t("emailInvalid"));
                    return;
                  }
                  if (draft.recipientEmails.includes(email)) {
                    setError(t("emailDuplicate"));
                    return;
                  }
                  setDraft({
                    ...draft,
                    recipientEmails: [...draft.recipientEmails, email],
                  });
                  setEmailDraft("");
                }}
              >
                {t("addEmail")}
              </Button>
            </div>
            {draft.recipientEmails.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {draft.recipientEmails.map((email) => (
                  <li
                    key={email}
                    className="flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800"
                  >
                    {email}
                    <button
                      type="button"
                      aria-label={t("removeRecipient")}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          recipientEmails: draft.recipientEmails.filter(
                            (e) => e !== email,
                          ),
                        })
                      }
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button onClick={save} disabled={isPending || !draft.name.trim()}>
              {isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      ) : null}
      {gate}
    </section>
  );
}

/**
 * One sentence an operator can act on, instead of a wall of provider text.
 *
 * Every recipient usually fails for the SAME reason — a quota, a bad key — so
 * the reason is said once and the addresses are summarised. The previous
 * version repeated each address twice and pasted the vendor's raw message per
 * recipient, which buried the one fact that mattered.
 */
function describeFailures(
  res: { delivered: number; recipients: number; failed: ReportFailure[] },
  t: ReturnType<typeof useTranslations<"automations.reports">>,
): string {
  // Group by cause, preferring the provider's error code over message text.
  const byCause = new Map<string, ReportFailure[]>();
  for (const f of res.failed) {
    const key = f.code ?? f.reason;
    const list = byCause.get(key);
    if (list) list.push(f);
    else byCause.set(key, [f]);
  }

  const parts = [...byCause.entries()].map(([key, group]) => {
    const cause = isDescribedSendFailure(key)
      ? t(`failure.${key}` as never)
      : // No wording for this one — fall back to the provider's text rather
        // than inventing a reassuring sentence.
        group[0].reason;
    return group.length === res.recipients
      ? cause
      : t("failureFor", { who: group.map((f) => f.email).join(", "), cause });
  });

  const headline =
    res.delivered === 0
      ? t("sentNone", { recipients: res.recipients })
      : t("sentSome", {
          delivered: res.delivered,
          recipients: res.recipients,
        });

  return `${headline} ${parts.join(" ")}`;
}
