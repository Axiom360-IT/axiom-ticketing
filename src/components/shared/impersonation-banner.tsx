"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { endImpersonation } from "@/app/actions/impersonation";

type Props = {
  targetName: string;
};

export function ImpersonationBanner({ targetName }: Props) {
  const router = useRouter();
  const t = useTranslations("users.impersonate");
  const [isPending, startTransition] = useTransition();

  function handleEnd() {
    startTransition(async () => {
      await endImpersonation();
      router.push("/admin");
      router.refresh();
    });
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-6 py-2 bg-amber-100 dark:bg-amber-950 border-b border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-sm"
    >
      <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">
        {t("bannerLabel", { name: targetName })}
      </span>
      <button
        type="button"
        onClick={handleEnd}
        disabled={isPending}
        className="font-medium underline hover:no-underline disabled:opacity-50"
      >
        {isPending ? t("ending") : t("bannerEnd")}
      </button>
    </div>
  );
}
