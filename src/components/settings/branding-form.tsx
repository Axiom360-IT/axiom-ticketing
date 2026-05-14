"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { SaveRow } from "./save-button";
import { Wordmark } from "@/components/branding/wordmark";
import {
  ACCENT_KEYS,
  GRADIENT_CSS,
  GRADIENT_KEYS,
  type AccentKey,
  type BrandingConfig,
  type GradientKey,
} from "@/lib/branding/presets";
import { updateSetting } from "@/app/actions/settings";

// Branding editor — single form that writes the whole `branding`
// settings object in one shot. The live preview re-renders on every
// change so admins can see the result before saving.

type Props = {
  initial: BrandingConfig;
};

export function BrandingForm({ initial }: Props) {
  const router = useRouter();
  const t = useTranslations("settings.branding");
  const { runWithReauth, gate } = useReauthGate();

  const [brandName, setBrandName] = useState(initial.brandName);
  const [brandAccent, setBrandAccent] = useState(initial.brandAccent);
  const [accentColor, setAccentColor] = useState<AccentKey>(initial.accentColor);
  const [gradientPreset, setGradientPreset] = useState<GradientKey>(
    initial.gradientPreset,
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await runWithReauth(
        () =>
          updateSetting("branding", {
            brandName,
            brandAccent,
            accentColor,
            gradientPreset,
          }),
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
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="b-name">{t("brandNameLabel")}</Label>
          <Input
            id="b-name"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            maxLength={40}
            required
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("brandNameHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-accent">{t("brandAccentLabel")}</Label>
          <Input
            id="b-accent"
            value={brandAccent}
            onChange={(e) => setBrandAccent(e.target.value)}
            maxLength={20}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("brandAccentHint")}
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="b-color">{t("accentColorLabel")}</Label>
          <select
            id="b-color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value as AccentKey)}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ACCENT_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(`accentOption.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-gradient">{t("gradientLabel")}</Label>
          <select
            id="b-gradient"
            value={gradientPreset}
            onChange={(e) => setGradientPreset(e.target.value as GradientKey)}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {GRADIENT_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(`gradientOption.${k}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Live preview ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          {t("previewLabel")}
        </p>
        <div
          className="relative overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 p-6"
          style={{ backgroundImage: GRADIENT_CSS[gradientPreset] }}
        >
          <div className="flex flex-col items-center gap-2 py-4 bg-white/60 dark:bg-zinc-900/60 rounded-md">
            <Wordmark
              brandName={brandName}
              brandAccent={brandAccent}
              accentColor={accentColor}
              size="lg"
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("previewSubtitle")}
            </p>
          </div>
        </div>
      </div>

      <SaveRow pending={pending} saved={saved} error={error} />
      {gate}
    </form>
  );
}
