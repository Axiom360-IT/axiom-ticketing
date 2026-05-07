import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
};

// Per ARCHITECTURE §18: messages live at `src/messages/<locale>.json`,
// request config at `src/lib/i18n.ts`.
const withNextIntl = createNextIntlPlugin("./src/lib/i18n.ts");

export default withNextIntl(nextConfig);
