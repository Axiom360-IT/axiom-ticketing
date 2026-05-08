"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  reactivateUser,
  resetUserPassword,
  unlockUser,
} from "@/app/actions/users";
import { resetUserTwoFactor } from "@/app/actions/two-factor";

export function ReactivateButton({ userId }: { userId: string }) {
  const router = useRouter();
  const t = useTranslations("users.edit");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await reactivateUser(userId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} disabled={isPending} variant="outline">
        {t("reactivateButton")}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function UnlockButton({ userId }: { userId: string }) {
  const router = useRouter();
  const t = useTranslations("users.edit");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await unlockUser(userId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} disabled={isPending} variant="outline">
        {t("unlockButton")}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ResetTwoFactorButton({ userId }: { userId: string }) {
  const router = useRouter();
  const t = useTranslations("users.edit");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await resetUserTwoFactor(userId);
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button
        onClick={handleClick}
        disabled={isPending}
        variant={confirming ? "destructive" : "outline"}
      >
        {confirming ? t("resetTwoFactorConfirm") : t("resetTwoFactorButton")}
      </Button>
      {confirming ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("resetTwoFactorWarn")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ResetPasswordButton({ userId }: { userId: string }) {
  const t = useTranslations("users.edit");
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    setStatus("idle");
    startTransition(async () => {
      const res = await resetUserPassword(userId);
      if (!res.ok) {
        setError(res.error);
        setStatus("error");
        return;
      }
      setStatus("sent");
    });
  }

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} disabled={isPending} variant="outline">
        {t("resetPasswordButton")}
      </Button>
      {status === "sent" ? (
        <p className="text-xs text-green-700 dark:text-green-400">
          {t("resetPasswordSent")}
        </p>
      ) : null}
      {status === "error" && error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
