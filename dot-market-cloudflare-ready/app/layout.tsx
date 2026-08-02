import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
// The package's default 400.css/700.css carry latin only — the Korean glyphs
// live in a separate subset. Only bold is loaded; display headings are the sole
// user of this face, and the Korean subset is ~450 KB per weight.
import "@fontsource/gowun-batang/korean-700.css";
import "@fontsource/gowun-batang/latin-700.css";
import "./globals.css";
import { SITE } from "./site-content";

// Latin/numeric label face. Korean text is set in Pretendard, loaded from the
// CDN in globals.css, with Gowun Batang for display headings.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${SITE.name} · 화가 이젤 도안 주문소`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: SITE.name,
    title: `${SITE.name} · 화가 이젤 도안 주문소`,
    description: SITE.description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variable must sit on <html>: globals.css resolves --font-mono on
    // :root, and a var() that is undefined there would void the whole property.
    <html lang="ko" className={geistMono.variable}>
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous"/>
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
