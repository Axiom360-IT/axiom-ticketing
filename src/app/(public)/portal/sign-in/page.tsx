import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Eye, Mail, MessageSquare } from "lucide-react";
import { AuthSplitShell } from "@/components/branding/auth-split-shell";
import { loadBranding } from "@/lib/branding/load";
import { ACCENT_CLASSES } from "@/lib/branding/presets";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.signIn");
  return { title: t("metaTitle") };
}

export default async function PortalSignInPage() {
  const t = await getTranslations("portal.signIn");
  const tPanel = await getTranslations("portal.signIn.panel");
  const branding = await loadBranding();
  const link = ACCENT_CLASSES[branding.accentColor].link;

  const features = [
    {
      icon: Eye,
      title: tPanel("featureTrackTitle"),
      description: tPanel("featureTrackDescription"),
    },
    {
      icon: MessageSquare,
      title: tPanel("featureReplyTitle"),
      description: tPanel("featureReplyDescription"),
    },
    {
      icon: Mail,
      title: tPanel("featureFastTitle"),
      description: tPanel("featureFastDescription"),
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
        <p>
          <span>{t("noAccount")} </span>
          <Link href="/portal/submit" className={`font-medium ${link}`}>
            {t("signUpLink")}
          </Link>
        </p>
      }
    >
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthSplitShell>
  );
}
