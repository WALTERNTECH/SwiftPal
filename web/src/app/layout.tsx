import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_SCRIPT } from "@/components/ThemeSwitch";
import { SITE } from "@/lib/site";
import "./globals.css";
import "./site.css";

const sans = Geist({ subsets: ["latin"], variable: "--geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SwiftPal — M-Pesa STK Push & B2C API", template: "%s · SwiftPal" },
  description: SITE.description,
  openGraph: { title: "SwiftPal", description: SITE.description, type: "website" },
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
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
