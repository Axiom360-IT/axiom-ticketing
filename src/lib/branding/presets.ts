// Static branding presets. Tailwind's JIT scans source for class names,
// so every color class we ever want at runtime MUST appear as a literal
// string here — generating class strings dynamically (e.g. `text-${c}-600`)
// will look fine in dev but get purged in prod. Adding a new preset =
// add a row to all four tables below.

export const ACCENT_KEYS = [
  "blue",
  "indigo",
  "violet",
  "emerald",
  "amber",
  "rose",
  "slate",
] as const;
export type AccentKey = (typeof ACCENT_KEYS)[number];

export const GRADIENT_KEYS = [
  "blue",
  "indigo",
  "violet",
  "emerald",
  "amber",
  "rose",
  "neutral",
] as const;
export type GradientKey = (typeof GRADIENT_KEYS)[number];

// Class fragments used by the wordmark + CTA links + focus rings + the
// "hero" panel background on the split sign-in layout. Every string
// here must be a literal class — Tailwind JIT scans this file for the
// classes to keep in the production bundle.
export const ACCENT_CLASSES: Record<
  AccentKey,
  {
    text: string;
    link: string;
    ring: string;
    panelBg: string;
    /** Decorative badge against a dark surface (sidebar avatar tile). */
    darkBadge: string;
  }
> = {
  blue: {
    text: "text-blue-600 dark:text-blue-400",
    link: "text-blue-600 hover:underline dark:text-blue-400",
    ring: "focus-visible:ring-blue-500",
    panelBg: "bg-gradient-to-br from-zinc-950 via-blue-950 to-zinc-950",
    darkBadge: "bg-blue-500/20 border-blue-400/30 text-blue-300",
  },
  indigo: {
    text: "text-indigo-600 dark:text-indigo-400",
    link: "text-indigo-600 hover:underline dark:text-indigo-400",
    ring: "focus-visible:ring-indigo-500",
    panelBg: "bg-gradient-to-br from-zinc-950 via-indigo-950 to-zinc-950",
    darkBadge: "bg-indigo-500/20 border-indigo-400/30 text-indigo-300",
  },
  violet: {
    text: "text-violet-600 dark:text-violet-400",
    link: "text-violet-600 hover:underline dark:text-violet-400",
    ring: "focus-visible:ring-violet-500",
    panelBg: "bg-gradient-to-br from-zinc-950 via-violet-950 to-zinc-950",
    darkBadge: "bg-violet-500/20 border-violet-400/30 text-violet-300",
  },
  emerald: {
    text: "text-emerald-600 dark:text-emerald-400",
    link: "text-emerald-600 hover:underline dark:text-emerald-400",
    ring: "focus-visible:ring-emerald-500",
    panelBg: "bg-gradient-to-br from-zinc-950 via-emerald-950 to-zinc-950",
    darkBadge: "bg-emerald-500/20 border-emerald-400/30 text-emerald-300",
  },
  amber: {
    text: "text-amber-600 dark:text-amber-500",
    link: "text-amber-600 hover:underline dark:text-amber-500",
    ring: "focus-visible:ring-amber-500",
    panelBg: "bg-gradient-to-br from-zinc-950 via-amber-950 to-zinc-950",
    darkBadge: "bg-amber-500/20 border-amber-400/30 text-amber-300",
  },
  rose: {
    text: "text-rose-600 dark:text-rose-400",
    link: "text-rose-600 hover:underline dark:text-rose-400",
    ring: "focus-visible:ring-rose-500",
    panelBg: "bg-gradient-to-br from-zinc-950 via-rose-950 to-zinc-950",
    darkBadge: "bg-rose-500/20 border-rose-400/30 text-rose-300",
  },
  slate: {
    text: "text-slate-700 dark:text-slate-300",
    link: "text-slate-700 hover:underline dark:text-slate-300",
    ring: "focus-visible:ring-slate-500",
    panelBg: "bg-gradient-to-br from-zinc-900 via-slate-950 to-black",
    darkBadge: "bg-slate-400/20 border-slate-300/30 text-slate-200",
  },
};

// Inline-style CSS gradients (not Tailwind classes) — applied via the
// `style` prop on the auth shell background. rgba components are picked
// to give a subtle wash without overpowering the form card.
export const GRADIENT_CSS: Record<GradientKey, string> = {
  blue:
    "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(37, 99, 235, 0.12), transparent 70%), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(37, 99, 235, 0.08), transparent 70%)",
  indigo:
    "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(79, 70, 229, 0.12), transparent 70%), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(79, 70, 229, 0.08), transparent 70%)",
  violet:
    "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(124, 58, 237, 0.12), transparent 70%), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(124, 58, 237, 0.08), transparent 70%)",
  emerald:
    "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(16, 185, 129, 0.12), transparent 70%), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(16, 185, 129, 0.08), transparent 70%)",
  amber:
    "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(245, 158, 11, 0.14), transparent 70%), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(245, 158, 11, 0.10), transparent 70%)",
  rose:
    "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(225, 29, 72, 0.12), transparent 70%), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(225, 29, 72, 0.08), transparent 70%)",
  neutral:
    "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(113, 113, 122, 0.10), transparent 70%), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(113, 113, 122, 0.06), transparent 70%)",
};

export type BrandingConfig = {
  brandName: string;
  brandAccent: string;
  accentColor: AccentKey;
  gradientPreset: GradientKey;
};

export const DEFAULT_BRANDING: BrandingConfig = {
  brandName: "Axiom",
  brandAccent: "360",
  accentColor: "blue",
  gradientPreset: "blue",
};

export function isAccentKey(v: unknown): v is AccentKey {
  return typeof v === "string" && (ACCENT_KEYS as readonly string[]).includes(v);
}
export function isGradientKey(v: unknown): v is GradientKey {
  return typeof v === "string" && (GRADIENT_KEYS as readonly string[]).includes(v);
}
