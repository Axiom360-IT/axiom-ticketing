import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Geist_Mono, Roboto } from "next/font/google";
import { CountryProvider } from "@/components/ui/phone-field";
import { getRequestCountry } from "@/lib/request-country";
import {
  parseTheme,
  THEME_COOKIE,
  THEME_INIT_SCRIPT,
  themeClass,
} from "@/lib/theme";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Axiom360 Ticketing System",
  description: "Internal IT ticketing for Axiom360.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const country = await getRequestCountry();
  // Applied during SSR so an explicit light/dark choice is correct on the very
  // first paint. "system" renders a marker class that the inline script below
  // resolves against the OS before anything else is parsed.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang={locale}
      className={`${roboto.variable} ${geistMono.variable} h-full antialiased ${themeClass(theme)}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Fixed, non-user string. Must run before paint, or a dark-mode
            visitor on "system" gets a flash of the light theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <NextIntlClientProvider>
          <CountryProvider country={country}>{children}</CountryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
