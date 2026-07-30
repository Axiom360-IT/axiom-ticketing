import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthSplitShell } from "@/components/branding/auth-split-shell";
import { loadBranding } from "@/lib/branding/load";
import { SetupForm } from "./setup-form";

// Landing page for the customer bulk-import invite email. The token's
// signature is checked at submit time by acceptCustomerInvite — we don't
// gate the render on it here, same reasoning as /admin/setup: an invalid
// or expired token fails at submit with a clear (deliberately generic)
// error rather than leaking which case it hit.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.setup");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<{ token?: string }>;

export default async function PortalSetupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { token } = await searchParams;
  const t = await getTranslations("portal.setup");

  if (!token) {
    return (
      <section className="max-w-md mx-auto py-16 px-4 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {t("missingTokenTitle")}
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {t("missingTokenBody")}
        </p>
        <div className="mt-8">
          <Link
            href="/portal/sign-in"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {t("goToSignIn")}
          </Link>
        </div>
      </section>
    );
  }

  const branding = await loadBranding();

  return (
    <AuthSplitShell
      branding={branding}
      panelTitle={t("title")}
      panelSubtitle={t("subtitle")}
      features={[]}
      formTitle={t("title")}
      formSubtitle={t("subtitle")}
    >
      <SetupForm token={token} />
    </AuthSplitShell>
  );
}
