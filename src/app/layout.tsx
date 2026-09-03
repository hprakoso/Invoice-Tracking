import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { I18nProvider } from "@/hooks/useI18n";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SIP",
  description: "Smart Invoice & Payment",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `dark` is the brand default; useTheme() flips it client-side.
    <html lang="id" className={`${jakarta.variable} dark`}>
      <body className="antialiased">
        {/* Layer 0 — ambient liquid background, fixed behind everything */}
        <div aria-hidden="true" className="liquid-bg">
          <div className="blob blob-1 blob-a" />
          <div className="blob blob-2 blob-b" />
          <div className="blob blob-3 blob-c" />
        </div>
        {/* Subtle film grain over the whole app */}
        <div aria-hidden="true" className="grain-overlay" />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
