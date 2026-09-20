import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { ThemeToggle } from "./theme-toggle";

/**
 * Reads the stored preference so <ThemeToggle> renders already-correct on the
 * server. Wrapped so client chrome (e.g. the customer topbar) can mount the
 * toggle without needing to thread the cookie value down itself.
 */
export async function ThemeToggleServer() {
  const jar = await cookies();
  return <ThemeToggle initial={parseTheme(jar.get(THEME_COOKIE)?.value)} />;
}
