import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Inbox, ShieldCheck, Timer } from "lucide-react";
import { AuthSplitShell } from "@/components/branding/auth-split-shell";
import { loadBranding } from "@/lib/branding/load";
import { LoginForm } from "./login-form";

// noindex/nofollow — admin entry point shouldn't be in Google. Doesn't
// stop attackers (bots discover it anyway) but reduces curious-visitor
// noise and keeps the URL out of public search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const t = await getTranslations("admin.login");
  const tPanel = await getTranslations("admin.login.panel");
  const branding = await loadBranding();

  const features = [
    {
      icon: Inbox,
      title: tPanel("featureQueueTitle"),
      description: tPanel("featureQueueDescription"),
    },
    {
      icon: Timer,
      title: tPanel("featureSlaTitle"),
      description: tPanel("featureSlaDescription"),
    },
    {
      icon: ShieldCheck,
      title: tPanel("featureGovernanceTitle"),
      description: tPanel("featureGovernanceDescription"),
    },
  ];

  return (
    <AuthSplitShell
      branding={branding}
      panelTitle={tPanel("title")}
      panelSubtitle={tPanel("subtitle")}
      features={features}
      formTitle={t("title")}
      formSubtitle={t("subtitle")}
    >
      <Suspense fallback={<LoginFormFallback />}>
        <LoginForm />
      </Suspense>
    </AuthSplitShell>
  );
}

function LoginFormFallback() {
  return (
    <div className="space-y-4">
      <div className="h-9 bg-zinc-100 dark:bg-zinc-800 rounded-md animate-pulse" />
      <div className="h-9 bg-zinc-100 dark:bg-zinc-800 rounded-md animate-pulse" />
      <div className="h-10 bg-zinc-100 dark:bg-zinc-800 rounded-md animate-pulse" />
    </div>
  );
}
