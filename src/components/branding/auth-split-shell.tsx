import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ACCENT_CLASSES,
  type BrandingConfig,
  DEFAULT_LOGO_SRC,
} from "@/lib/branding/presets";
import { cn } from "@/lib/utils";

// Split-screen sign-in layout. Left = brand hero panel (layered gradient,
// official logo, headline, feature list). Right = the form card.
//
// On screens below `lg` the hero panel is hidden entirely — there isn't room
// to do it justice and the form is what matters on mobile. The logo still
// renders as a small bar above the form so mobile visitors keep brand presence.

export type SplitFeature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

type Props = {
  branding: BrandingConfig;
  /** Hero panel headline (e.g. "The command center for your service desk"). */
  panelTitle: string;
  /** One-line supporting copy beneath the headline. */
  panelSubtitle: string;
  /** 2–4 feature bullets with icons. */
  features: readonly SplitFeature[];
  /** Form card heading. */
  formTitle: string;
  /** Form card supporting copy. */
  formSubtitle: string;
  /** Optional reassurance line pinned to the hero footer (e.g. security note). */
  panelFootnote?: ReactNode;
  /** The form itself. */
  children: ReactNode;
  /** Optional content under the form card (e.g. "Don't have an account?"). */
  footerSlot?: ReactNode;
};

// The logo is drawn in dark navy on a transparent square canvas, so it needs a
// light plate to read on any surface. `object-cover` crops the file's baked-in
// transparent margins so the mark fills the plate instead of floating small.
function LogoPlate({
  src,
  alt,
  className,
  imgClassName,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center overflow-hidden rounded-xl bg-white p-1.5 shadow-lg shadow-black/15 ring-1 ring-black/5",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- src is either a
          signed R2 URL or a /public asset; neither fits next/image remotePatterns. */}
      <img
        src={src}
        alt={alt}
        className={cn(
          "object-cover object-center rounded-md",
          imgClassName ?? "h-9 w-36",
        )}
      />
    </span>
  );
}

export function AuthSplitShell({
  branding,
  panelTitle,
  panelSubtitle,
  features,
  formTitle,
  formSubtitle,
  panelFootnote,
  children,
  footerSlot,
}: Props) {
  const accent = ACCENT_CLASSES[branding.accentColor];
  const logoSrc = branding.logoUrl ?? DEFAULT_LOGO_SRC;
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-zinc-50 dark:bg-zinc-950">
      {/* ── Left: brand hero panel ────────────────────────────────── */}
      <aside
        className={cn(
          "relative hidden lg:flex flex-col justify-between overflow-hidden p-10 xl:p-14 text-white",
          accent.panelBg,
        )}
      >
        {/* Fine dot grid for texture — pure CSS, no asset load. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        {/* Soft glow top-left for depth. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 -left-40 size-[30rem] rounded-full opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.35), transparent 70%)",
          }}
        />
        {/* Accent glow bottom-right to frame the content. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-48 -right-32 size-[34rem] rounded-full opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(96,165,250,0.45), transparent 70%)",
          }}
        />
        {/* Concentric orbital motif — a quiet "everything in one place" graphic. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 400 400"
          fill="none"
          className="pointer-events-none absolute -right-28 top-1/2 h-[46rem] w-[46rem] -translate-y-1/2 text-white opacity-[0.10]"
        >
          <circle cx="200" cy="200" r="70" stroke="currentColor" strokeWidth="1" />
          <circle cx="200" cy="200" r="130" stroke="currentColor" strokeWidth="1" />
          <circle cx="200" cy="200" r="190" stroke="currentColor" strokeWidth="1" />
        </svg>

        {/* Top: official logo */}
        <header className="relative">
          <Link
            href="/"
            className="inline-block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <LogoPlate src={logoSrc} alt={branding.brandName} />
          </Link>
        </header>

        {/* Middle: headline + copy + features */}
        <div className="relative max-w-md">
          <h2 className="text-balance text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
            {panelTitle}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            {panelSubtitle}
          </p>

          <ul className="mt-10 space-y-3">
            {features.map((f) => (
              <li
                key={f.title}
                className="flex gap-4 rounded-xl p-3 ring-1 ring-white/0 transition-colors hover:bg-white/5 hover:ring-white/10"
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                  <f.icon className="size-4.5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-medium">{f.title}</p>
                  <p className="text-sm leading-relaxed text-white/70">
                    {f.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer: optional reassurance line + copyright */}
        <footer className="relative space-y-3">
          {panelFootnote ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 ring-1 ring-white/15">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-emerald-400"
              />
              {panelFootnote}
            </p>
          ) : null}
          {/* eslint-disable-next-line i18next/no-literal-string -- copyright glyph + runtime brand name */}
          <p className="text-xs text-white/55">© {year} {branding.brandName}</p>
        </footer>
      </aside>

      {/* ── Right: form column ────────────────────────────────────── */}
      <section className="flex flex-col px-4 py-10 sm:px-6">
        {/* Mobile-only top logo — the hero panel is hidden below lg. */}
        <header className="lg:hidden">
          <Link
            href="/"
            className="inline-block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            <LogoPlate
              src={logoSrc}
              alt={branding.brandName}
              imgClassName="h-7 w-28"
            />
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center py-6">
          <div className="w-full max-w-md">
            <div className="rounded-2xl bg-white p-6 shadow-xl shadow-zinc-900/5 ring-1 ring-zinc-200 sm:p-8 dark:bg-zinc-900 dark:ring-zinc-800">
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
