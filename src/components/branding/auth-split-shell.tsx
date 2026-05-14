import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Wordmark } from "@/components/branding/wordmark";
import {
  ACCENT_CLASSES,
  type BrandingConfig,
} from "@/lib/branding/presets";

// Split-screen sign-in layout. Left = brand hero panel (gradient,
// wordmark, tagline, feature list). Right = the form card.
//
// On screens below `lg` the hero panel is hidden entirely — there
// isn't room to do it justice and the form is what matters on mobile.
// Brand wordmark still renders as a small bar above the form so
// mobile visitors don't lose all brand presence.

export type SplitFeature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

type Props = {
  branding: BrandingConfig;
  /** Hero panel headline (e.g. "Support that scales with your team"). */
  panelTitle: string;
  /** One-line supporting copy beneath the headline. */
  panelSubtitle: string;
  /** 2–4 feature bullets with icons. */
  features: readonly SplitFeature[];
  /** Form card heading. */
  formTitle: string;
  /** Form card supporting copy. */
  formSubtitle: string;
  /** The form itself. */
  children: ReactNode;
  /** Optional content under the form card (e.g. "Don't have an account?"). */
  footerSlot?: ReactNode;
};

export function AuthSplitShell({
  branding,
  panelTitle,
  panelSubtitle,
  features,
  formTitle,
  formSubtitle,
  children,
  footerSlot,
}: Props) {
  const accent = ACCENT_CLASSES[branding.accentColor];

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-zinc-50 dark:bg-zinc-950">
      {/* ── Left: brand panel ─────────────────────────────────────── */}
      <aside
        className={`relative hidden lg:flex flex-col justify-between overflow-hidden p-10 xl:p-14 text-white ${accent.panelBg}`}
      >
        {/* Subtle dot pattern overlay — pure CSS, no asset load. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        {/* Soft glow in top-left for depth. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -left-32 size-96 rounded-full opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.4), transparent 70%)",
          }}
        />

        <header className="relative">
          <Wordmark
            brandName={branding.brandName}
            brandAccent={branding.brandAccent}
            accentColor={branding.accentColor}
            size="lg"
            onDark
            href="/"
          />
        </header>

        <div className="relative max-w-md">
          <h2 className="text-3xl xl:text-4xl font-semibold leading-tight tracking-tight">
            {panelTitle}
          </h2>
          <p className="mt-3 text-base text-white/80">{panelSubtitle}</p>

          <ul className="mt-10 space-y-5">
            {features.map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="shrink-0 inline-flex size-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                  <f.icon className="size-4.5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-medium">{f.title}</p>
                  <p className="text-sm text-white/75 leading-relaxed">
                    {f.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <footer className="relative text-xs text-white/60 flex items-center gap-1">
          {/* eslint-disable-next-line i18next/no-literal-string -- generic copyright glyph */}
          <span>© {new Date().getFullYear()}</span>
          <Wordmark
            brandName={branding.brandName}
            brandAccent={branding.brandAccent}
            accentColor={branding.accentColor}
            size="sm"
            onDark
            className="!text-xs"
          />
        </footer>
      </aside>

      {/* ── Right: form column ────────────────────────────────────── */}
      <section className="flex flex-col px-4 sm:px-6 py-10">
        {/* Mobile-only top wordmark — the hero panel is hidden below lg
            so we ensure brand is still visible above the form. */}
        <header className="lg:hidden">
          <Wordmark
            brandName={branding.brandName}
            brandAccent={branding.brandAccent}
            accentColor={branding.accentColor}
            size="md"
            href="/"
          />
        </header>

        <main className="flex flex-1 items-center justify-center py-6">
          <div className="w-full max-w-md">
            <div className="rounded-xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-xl shadow-zinc-900/5 p-6 sm:p-8">
              <header className="mb-6">
                <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {formTitle}
                </h1>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {formSubtitle}
                </p>
              </header>
              {children}
            </div>
            {footerSlot ? (
              <div className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
                {footerSlot}
              </div>
            ) : null}
          </div>
        </main>
      </section>
    </div>
  );
}
