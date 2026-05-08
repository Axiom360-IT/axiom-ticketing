"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  disableTwoFactor,
  enableTwoFactor,
  regenerateBackupCodes,
  verifyTotpCode,
} from "@/app/actions/two-factor";

type Props = {
  enabled: boolean;
  canDisable: boolean;
};

type EnrolState = {
  totpUri: string;
  backupCodes: string[];
  verified: boolean;
};

export function TwoFactorSection({ enabled, canDisable }: Props) {
  const router = useRouter();
  const t = useTranslations("profile.twoFactor");

  const [password, setPassword] = useState("");
  const [enrolment, setEnrolment] = useState<EnrolState | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleEnable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await enableTwoFactor(password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEnrolment({
        totpUri: res.totpUri,
        backupCodes: res.backupCodes,
        verified: false,
      });
      try {
        const QRCode = (await import("qrcode")).default;
        const svg = await QRCode.toString(res.totpUri, {
          type: "svg",
          margin: 1,
          width: 192,
        });
        setQrSvg(svg);
      } catch (err) {
        console.error("[twoFactor] QR render failed:", err);
      }
      setPassword("");
      router.refresh();
    });
  }

  function handleDisable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await disableTwoFactor(password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEnrolment(null);
      setVerified(false);
      setQrSvg(null);
      setPassword("");
      router.refresh();
    });
  }

  function handleVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setVerifyError(null);
    startTransition(async () => {
      const res = await verifyTotpCode(verifyCode);
      if (!res.ok) {
        setVerifyError(res.error);
        return;
      }
      setVerified(true);
      setVerifyCode("");
    });
  }

  function handleRegenerate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await regenerateBackupCodes(password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEnrolment({
        totpUri: enrolment?.totpUri ?? "",
        backupCodes: res.backupCodes,
        verified: true,
      });
      setPassword("");
    });
  }

  // Enrolment in progress: show the QR + backup codes + verify form.
  if (enrolment) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">{t("qrTitle")}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("qrHelp")}
          </p>
        </div>
        {qrSvg ? (
          <div
            className="inline-block rounded-md border border-zinc-200 dark:border-zinc-800 p-2 bg-white"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : null}
        <div className="space-y-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("secretLabel")}
          </p>
          <code className="block text-xs font-mono break-all px-2 py-1 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            {enrolment.totpUri}
          </code>
        </div>

        {!verified ? (
          <form onSubmit={handleVerify} className="space-y-2 max-w-xs">
            <Label htmlFor="totp-verify">{t("verifyTitle")}</Label>
            <Input
              id="totp-verify"
              inputMode="numeric"
              pattern="\d{6}"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              maxLength={6}
              required
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? t("verifying") : t("verifyButton")}
            </Button>
            {verifyError ? (
              <p
                role="alert"
                className="text-xs text-red-600 dark:text-red-400"
              >
                {verifyError}
              </p>
            ) : null}
          </form>
        ) : (
          <p className="text-xs text-green-700 dark:text-green-400">
            {t("verifySuccess")}
          </p>
        )}

        {enrolment.backupCodes.length > 0 ? (
          <div className="space-y-1">
            <h4 className="text-sm font-medium">{t("backupTitle")}</h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("backupHint")}
            </p>
            <ul className="grid grid-cols-2 gap-1 mt-1 max-w-md">
              {enrolment.backupCodes.map((code) => (
                <li
                  key={code}
                  className="font-mono text-xs px-2 py-1 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                >
                  {code}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  // Already enabled — disable / regenerate UI.
  if (enabled) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {t("subtitleEnabled")}
        </p>

        <form onSubmit={handleRegenerate} className="space-y-2 max-w-md">
          <Label htmlFor="regen-pw">{t("passwordPrompt")}</Label>
          <Input
            id="regen-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className="flex flex-wrap gap-2 items-center">
            <Button type="submit" variant="outline" disabled={isPending}>
              {isPending ? t("regenerating") : t("regenerateButton")}
            </Button>
            {canDisable ? (
              <Button
                type="button"
                variant="destructive"
                disabled={isPending}
                onClick={(ev) =>
                  handleDisable(
                    ev as unknown as FormEvent<HTMLFormElement>,
                  )
                }
              >
                {isPending ? t("disabling") : t("disableButton")}
              </Button>
            ) : null}
          </div>
          {!canDisable ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t("privilegedNote")}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    );
  }

  // Not enabled — enable UI.
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        {t("subtitleDisabled")}
      </p>
      <form onSubmit={handleEnable} className="space-y-2 max-w-md">
        <Label htmlFor="enable-pw">{t("passwordPrompt")}</Label>
        <Input
          id="enable-pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? t("enabling") : t("enableButton")}
        </Button>
        {error ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
