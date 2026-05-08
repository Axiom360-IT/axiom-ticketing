import { getTranslations } from "next-intl/server";

// Skip-to-main-content link. Keyboard users hit Tab on page load, focus
// lands here, Enter jumps past the sidebar/topbar to the page content.
// Hidden by default, visible only when focused (CSS focus-visible).

export async function SkipLink() {
  const t = await getTranslations("admin.shell");
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-blue-600 focus:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {t("skipToContent")}
    </a>
  );
}
