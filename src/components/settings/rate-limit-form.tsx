"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      const res = await updateSetting(settingKey, values);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  type LabelKey = Parameters<typeof tLabels>[0];
  type FieldKey = Parameters<typeof tFields>[0];

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 px-3 py-3 rounded-md border border-zinc-200 dark:border-zinc-800"
    >
      <div className="text-sm font-medium">{tLabels(settingKey as LabelKey)}</div>
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
    </form>
  );
}
