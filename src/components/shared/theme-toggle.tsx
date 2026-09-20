"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEMES,
  type Theme,
} from "@/lib/theme";

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

// Module scope on purpose: assigning to `document.cookie` inside the component
// trips the React Compiler's immutability rule (it sees a write to a value
// defined outside the component).
function persistTheme(theme: Theme): void {
  document.cookie = `${THEME_COOKIE}=${theme};path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax`;
}

/**
 * Light / Dark / System picker. Applies the change on the spot by writing the
 * cookie and toggling the <html> class — no server round-trip, so the switch is
 * instant; the cookie is what the next SSR render reads back.
 *
 * `initial` comes from the server so the checked option and the trigger icon
 * match on first render (no hydration mismatch, no flicker).
 */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const t = useTranslations("common.theme");
  const [theme, setTheme] = useState<Theme>(initial);

  const apply = useCallback((next: Theme) => {
    const root = document.documentElement;
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("theme-system", next === "system");
    root.classList.toggle(
      "dark",
      next === "dark" || (next === "system" && prefersDark),
    );
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    apply(next);
    persistTheme(next);
  }

  // While on "system", follow the OS if it flips (e.g. a scheduled night mode)
  // without needing a reload.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, apply]);

  const TriggerIcon = ICONS[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center justify-center w-8 h-8 rounded-md text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-colors"
        aria-label={t("label")}
        title={t("label")}
      >
        <TriggerIcon className="w-4 h-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {THEMES.map((value) => {
          const Icon = ICONS[value];
          return (
            <DropdownMenuItem key={value} onClick={() => choose(value)}>
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span className="flex-1">{t(value)}</span>
              {theme === value ? (
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
