import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { THEME_SCRIPT } from "@/components/ThemeSwitch";
import "./globals.css";
import "./console.css";
import "./admin.css";

const sans = Geist({ subsets: ["latin"], variable: "--geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SwiftPal Admin", template: "%s · SwiftPal Admin" },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#050706" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} data-theme="light" suppressHydrationWarning>
      <body>
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
