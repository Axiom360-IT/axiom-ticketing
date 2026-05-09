"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { updateSetting } from "@/app/actions/settings";
import { SaveRow } from "./save-button";

type Props = {
  /** Setting key (e.g. "rate_limits.public_submit"). */
  settingKey: string;
  /** Initial values shape, exactly as stored in DB. */
  initial: Record<string, number>;
};

export function RateLimitForm({ settingKey, initial }: Props) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  const tLabels = useTranslations("settings.rateLimits.labels");
  const tFields = useTranslations("settings.rateLimits.fields");
  const [values, setValues] = useState<Record<string, number>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await runWithReauth(
        () => updateSetting(settingKey, values),
        "settings",
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  // next-intl 4.x forbids `.` in message keys (it interprets them as
  // nesting), so the canonical setting keys (e.g. `rate_limits.login`)
  // are stored in the messages file with `.` replaced by `__`.
  type LabelKey = Parameters<typeof tLabels>[0];
  type FieldKey = Parameters<typeof tFields>[0];
  const labelKey = settingKey.replace(/\./g, "__") as LabelKey;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 px-3 py-3 rounded-md border border-zinc-200 dark:border-zinc-800"
    >
      <div className="text-sm font-medium">{tLabels(labelKey)}</div>
      <div className="grid sm:grid-cols-2 gap-3">
        {Object.entries(values).map(([fieldKey, current]) => (
          <div key={fieldKey} className="space-y-1.5">
            <Label htmlFor={`rl-${settingKey}-${fieldKey}`}>
              {tFields(fieldKey as FieldKey)}
            </Label>
            <Input
              id={`rl-${settingKey}-${fieldKey}`}
              type="number"
              min={1}
              value={current}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [fieldKey]: Number(e.target.value),
                }))
              }
            />
          </div>
        ))}
      </div>
      <SaveRow pending={isPending} saved={saved} error={error} />
      {gate}
    </form>
  );
}
