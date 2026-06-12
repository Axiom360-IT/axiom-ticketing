import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Geist_Mono, Roboto } from "next/font/google";
import { CountryProvider } from "@/components/ui/phone-field";
import { getRequestCountry } from "@/lib/request-country";
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
  return (
    <html
      lang={locale}
      className={`${roboto.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          <CountryProvider country={country}>{children}</CountryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
