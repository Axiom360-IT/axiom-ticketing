"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type WorkLogFormValue = {
  description: string;
  hours: string;
  minutes: string;
  serviceType: string;
};

export const EMPTY_WORK_LOG: WorkLogFormValue = {
  description: "",
  hours: "",
  minutes: "",
  serviceType: "remote",
};

/** Total minutes from the hours/minutes string pair (0 when blank). */
export function workLogMinutes(value: WorkLogFormValue): number {
  return (
    (Number.parseInt(value.hours || "0", 10) || 0) * 60 +
    (Number.parseInt(value.minutes || "0", 10) || 0)
  );
}

/**
 * The description + time-spent + service-type fields shared by the "Add
 * time" and "Edit entry" timesheet modals. Controlled: the parent owns the
 * value and submission. Labels come from `tickets.workLog` so they match the
 * per-ticket work-log card exactly.
 */
export function WorkLogFields({
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  value: WorkLogFormValue;
  onChange: (patch: Partial<WorkLogFormValue>) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const t = useTranslations("tickets.workLog");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-description`}>
          {t("descriptionLabel")}
        </Label>
        <Textarea
          id={`${idPrefix}-description`}
          required
          rows={2}
          maxLength={2000}
          value={value.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t("descriptionPlaceholder")}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-hours`}>{t("timeLabel")}</Label>
          <div className="flex items-center gap-1.5">
            <Input
              id={`${idPrefix}-hours`}
              type="number"
              min={0}
              max={24}
              value={value.hours}
              onChange={(e) => onChange({ hours: e.target.value })}
              className="w-14 text-center tabular-nums"
              aria-label={t("hoursLabel")}
              disabled={disabled}
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {t("hoursShort")}
            </span>
            <Input
              id={`${idPrefix}-minutes`}
              type="number"
              min={0}
              max={59}
              value={value.minutes}
              onChange={(e) => onChange({ minutes: e.target.value })}
              className="w-14 text-center tabular-nums"
              aria-label={t("minutesLabel")}
              disabled={disabled}
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {t("minutesShort")}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-service`}>{t("serviceTypeLabel")}</Label>
          <Select
            items={{ remote: t("serviceRemote"), onsite: t("serviceOnsite") }}
            value={value.serviceType}
            onValueChange={(v) => onChange({ serviceType: v ?? "remote" })}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-service`} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="remote">{t("serviceRemote")}</SelectItem>
              <SelectItem value="onsite">{t("serviceOnsite")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
