import type { ReactNode } from "react";
import { Wordmark } from "@/components/branding/wordmark";
import { GRADIENT_CSS, type BrandingConfig } from "@/lib/branding/presets";
import { cn } from "@/lib/utils";

// Shared visual shell for sign-in / sign-up / submit pages. Gives all
// public auth surfaces a consistent gradient backdrop, centered card,
// and brand wordmark — so customers and staff land on pages that feel
// like the same product even though they live under different routes.

type Props = {
  /** Resolved branding from `loadBranding()` on the server. */
  branding: BrandingConfig;
  /** Card content (form, copy, etc.). */
  children: ReactNode;
  /** Optional content rendered below the card (e.g. "Submit as guest →"). */
  footerSlot?: ReactNode;
  /** Width of the card. Default = "narrow" suits a typical sign-in form. */
  width?: "narrow" | "wide";
};

export function AuthShell({ branding, children, footerSlot, width = "narrow" }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      {/* Soft radial accent — pure CSS so it ships with no asset load. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ backgroundImage: GRADIENT_CSS[branding.gradientPreset] }}
      />
      {/* Subtle grid texture — also CSS-only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.025] dark:opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative flex min-h-screen flex-col px-4 py-10">
        <header className="mx-auto w-full max-w-5xl">
          <Wordmark
            brandName={branding.brandName}
            brandAccent={branding.brandAccent}
            accentColor={branding.accentColor}
            size="md"
            href="/"
          />
        </header>

        <main className="flex flex-1 items-center justify-center py-8">
          <div
            className={cn(
              "w-full",
              width === "narrow" ? "max-w-md" : "max-w-2xl",
            )}
          >
            <div className="rounded-xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-xl shadow-blue-900/5 p-6 sm:p-8">
              {children}
            </div>
            {footerSlot ? (
              <div className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
                {footerSlot}
              </div>
            ) : null}
          </div>
        </main>

        <footer className="mx-auto w-full max-w-5xl text-center text-xs text-zinc-500 dark:text-zinc-500">
          {/* eslint-disable-next-line i18next/no-literal-string -- generic copyright glyph */}
          <span>© {new Date().getFullYear()} </span>
          <Wordmark
            brandName={branding.brandName}
            brandAccent={branding.brandAccent}
            accentColor={branding.accentColor}
            size="sm"
            className="!text-xs"
          />
        </footer>
      </div>
    </div>
  );
}
