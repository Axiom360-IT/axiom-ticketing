// Light / dark theme preference.
//
// The whole app was already written with ~1,500 `dark:` utilities and a
// complete `.dark` token block, switched by an ancestor class
// (`@custom-variant dark (&:is(.dark *))` in globals.css) — but nothing ever
// set that class, so the dark theme was unreachable. This is the missing
// switch.
//
// Stored in a plain (non-httpOnly) cookie rather than on the user row so it
// works for EVERY visitor — staff, signed-in customers, and guests following a
// ticket link with no account at all — and so the root layout can apply it
// during SSR, which is what keeps the first paint flash-free.

export const THEME_COOKIE = "axiom_theme";
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "system";
/** One year — a display preference, not a session concern. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTheme(value: string | undefined | null): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : DEFAULT_THEME;
}

/**
 * The class the server puts on <html>. "system" gets its own marker rather
 * than a resolved value because the server can't see the visitor's OS
 * preference — the pre-paint script in the root layout resolves it.
 */
export function themeClass(theme: Theme): string {
  if (theme === "dark") return "dark";
  if (theme === "system") return "theme-system";
  return "";
}

/**
 * Runs before first paint (first child of <body>, so nothing below it has
 * been parsed yet). Only has work to do for "system": every explicit choice
 * is already on <html> from the server.
 */
export const THEME_INIT_SCRIPT = `try{var e=document.documentElement;if(e.classList.contains('theme-system')&&window.matchMedia('(prefers-color-scheme: dark)').matches){e.classList.add('dark')}}catch(_){}`;
