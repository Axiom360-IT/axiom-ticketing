"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
};

export function StringSettingForm({
  settingKey,
  label,
  initial,
  type = "text",
  hint,
  readOnly = false,
  maxLength,
}: StringProps) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateSetting(settingKey, value);
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
          required
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
};

export function NumberSettingForm({
  settingKey,
  label,
  initial,
  hint,
  min,
  max,
  step,
}: NumberProps) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateSetting(settingKey, value);
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
        <Input
          id={`s-${settingKey}`}
          type="number"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
        />
        {hint ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
        ) : null}
      </div>
      <SaveRow pending={isPending} saved={saved} error={error} />
    </form>
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
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    setError(null);
    setValue(next);
    startTransition(async () => {
      const res = await updateSetting(settingKey, next);
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
    </div>
  );
}
