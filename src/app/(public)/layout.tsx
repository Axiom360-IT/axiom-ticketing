import { SkipLink } from "@/components/shared/skip-link";

// Public group layout — adds the skip-to-main-content link and a
// landmark <main> wrapper. Each public page (portal, csat) renders
// inside this main, so screen-reader users can jump straight to it.

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
    </>
  );
}
