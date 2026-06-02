"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { updateSetting } from "@/app/actions/settings";
import { SaveRow } from "./save-button";

type StringProps = {
  settingKey: string;
  label: string;
  initial: string;
  type?: "text" | "email";
  hint?: string;
  readOnly?: boolean;
  maxLength?: number;
  /** Allow saving an empty value. Defaults to required. */
  optional?: boolean;
};

export function StringSettingForm({
  settingKey,
  label,
  initial,
  type = "text",
  hint,
  readOnly = false,
  maxLength,
  optional = false,
}: StringProps) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await runWithReauth(
        () => updateSetting(settingKey, value),
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

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor={`s-${settingKey}`}>{label}</Label>
        <Input
          id={`s-${settingKey}`}
          type={type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required={!optional}
          readOnly={readOnly}
          disabled={readOnly}
          maxLength={maxLength}
        />
        {hint ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
        ) : null}
      </div>
      {!readOnly ? (
        <SaveRow pending={isPending} saved={saved} error={error} />
      ) : null}
      {gate}
    </form>
  );
}

type NumberProps = {
  settingKey: string;
  label: string;
  initial: number;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Display the value in a larger unit while persisting the base value.
   *  e.g. scale=1048576 + unitSuffix="MB" shows bytes as megabytes
   *  (Meeting-2, CR-04 — the size limit must read in MB, not KB/bytes). */
  scale?: number;
  unitSuffix?: string;
};

export function NumberSettingForm({
  settingKey,
  label,
  initial,
  hint,
  min,
  max,
  step,
  scale,
  unitSuffix,
}: NumberProps) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  // Hold the value in DISPLAY units; convert to the base unit on save.
  const factor = scale && scale > 0 ? scale : 1;
  const [value, setValue] = useState(initial / factor);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await runWithReauth(
        () => updateSetting(settingKey, Math.round(value * factor)),
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

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <div className="space-y-1.5 max-w-sm">
        <Label htmlFor={`s-${settingKey}`}>{label}</Label>
        <div className="flex items-center gap-2">
          <Input
            id={`s-${settingKey}`}
            type="number"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            min={min}
            max={max}
            step={step}
          />
          {unitSuffix ? (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {unitSuffix}
            </span>
          ) : null}
        </div>
        {hint ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
        ) : null}
      </div>
      <SaveRow pending={isPending} saved={saved} error={error} />
      {gate}
    </form>
  );
}

type SelectOption = { value: string; label: string };
type SelectProps = {
  settingKey: string;
  label: string;
  initial: string;
  options: readonly SelectOption[];
  hint?: string;
};

export function SelectSettingForm({
  settingKey,
  label,
  initial,
  options,
  hint,
}: SelectProps) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    setError(null);
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const res = await runWithReauth(
        () => updateSetting(settingKey, next),
        "settings",
      );
      if (!res.ok) {
        setError(res.error);
        setValue(prev);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5 max-w-sm">
      <Label htmlFor={`s-${settingKey}`}>{label}</Label>
      <select
        id={`s-${settingKey}`}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending}
        className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {gate}
    </div>
  );
}

type BooleanProps = {
  settingKey: string;
  label: string;
  initial: boolean;
  description?: string;
};

export function BooleanSettingForm({
  settingKey,
  label,
  initial,
  description,
}: BooleanProps) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    setError(null);
    setValue(next);
    startTransition(async () => {
      const res = await runWithReauth(
        () => updateSetting(settingKey, next),
        "settings",
      );
      if (!res.ok) {
        setError(res.error);
        // revert on failure
        setValue(!next);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => handleChange(e.target.checked)}
          disabled={isPending}
        />
        <span>{label}</span>
      </label>
      {description ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {gate}
    </div>
  );
}
