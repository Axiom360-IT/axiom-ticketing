"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

// Escape hatch on the forced enrolment screen — the user can always
// sign out and return to /admin/login if they don't want to enrol now.
export function ForcedSignOutButton() {
  const router = useRouter();
  const t = useTranslations("profile.twoFactorRequired");
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await authClient.signOut();
      router.replace("/admin/login");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={isPending}
    >
      {t("signOut")}
    </Button>
  );
}
