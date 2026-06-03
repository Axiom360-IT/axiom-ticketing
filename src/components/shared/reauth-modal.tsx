"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { verifyReauth } from "@/app/actions/reauth";

// Generic password-confirmation modal used by sensitive Server Actions
// (M17 Phase B). The action throws "REAUTH_REQUIRED"; the calling form
// catches it, opens this modal, and re-runs the action on success.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: () => void;
  reasonKey?: string;
};

export function ReauthModal({
  open,
  onOpenChange,
  onVerified,
  reasonKey = "default",
}: Props) {
  const t = useTranslations("reauth");
  const tCommon = useTranslations("common");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await verifyReauth(password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPassword("");
      onOpenChange(false);
      onVerified();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t(`reason.${reasonKey}`)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="reauth-password">{t("passwordLabel")}</Label>
            <PasswordInput
              id="reauth-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              showLabel={tCommon("showPassword")}
              hideLabel={tCommon("hidePassword")}
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={isPending || !password}>
              {isPending ? t("verifying") : t("verify")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Helper: detect the sentinel error thrown by `requireRecentReauth`. */
export function isReauthRequiredError(err: unknown): boolean {
  return err instanceof Error && err.message === "REAUTH_REQUIRED";
}
