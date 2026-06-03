import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BellRing, Inbox, KeyRound } from "lucide-react";
import { AuthSplitShell } from "@/components/branding/auth-split-shell";
import { loadBranding } from "@/lib/branding/load";
import { ACCENT_CLASSES } from "@/lib/branding/presets";
import { SignUpForm } from "./sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.signUp");
  return { title: t("metaTitle") };
}

export default async function PortalSignUpPage() {
  const t = await getTranslations("portal.signUp");
  const tPanel = await getTranslations("portal.signUp.panel");
  const branding = await loadBranding();
  const link = ACCENT_CLASSES[branding.accentColor].link;

  const features = [
    {
      icon: Inbox,
      title: tPanel("featureTrackTitle"),
      description: tPanel("featureTrackDescription"),
    },
    {
      icon: KeyRound,
      title: tPanel("featureFastTitle"),
      description: tPanel("featureFastDescription"),
    },
    {
      icon: BellRing,
      title: tPanel("featureUpdatesTitle"),
      description: tPanel("featureUpdatesDescription"),
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
      footerSlot={
        <div className="space-y-1.5 text-center">
          <p>
            <span>{t("alreadyHave")} </span>
            <Link href="/portal/sign-in" className={`font-medium ${link}`}>
              {t("signInLink")}
            </Link>
          </p>
          <p>
            <span>{t("guestSubmitPrefix")} </span>
            <Link href="/portal/submit" className={`font-medium ${link}`}>
              {t("guestSubmitLink")}
            </Link>
          </p>
        </div>
      }
    >
      <Suspense>
        <SignUpForm />
      </Suspense>
    </AuthSplitShell>
  );
}
