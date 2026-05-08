"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { reactivateUser, resetUserPassword } from "@/app/actions/users";

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
