"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startImpersonation } from "@/app/actions/impersonation";

export function ImpersonateButton({ userId }: { userId: string }) {
  const router = useRouter();
  const t = useTranslations("users.impersonate");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await startImpersonation(userId);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.push("/admin");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("genericError"));
      }
    });
  }

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} disabled={isPending} variant="outline">
        <UserCog className="size-3.5" aria-hidden="true" />
        {isPending ? t("starting") : t("button")}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
