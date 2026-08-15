import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "../src/index.css";
import { dirFor, LANG_COOKIE, parseLang } from "../src/lib/lang";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "DEEV",
  icons: { icon: "/favicon.svg" },
  // Domain-ownership proof for enamad.ir, which fetches the homepage and looks
  // for this exact tag. It belongs in the root layout rather than a page: the
  // crawler lands on `/`, and an anonymous visitor gets the landing page from
  // the session gate below, so only the shared <head> is guaranteed to carry it.
  other: { enamad: "11292457" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0a0b",
};

/**
 * What index.html used to be.
 *
 * `lang`/`dir` are resolved from the cookie on the server so Persian renders
 * right-to-left in the first byte. They used to be written by an effect in
 * i18n.tsx, which under SSR means one frame of the wrong direction plus a
 * hydration mismatch warning. Reading a cookie opts the tree into dynamic
 * rendering — correct here, since every route below is a signed-in surface with
 * nothing cacheable.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);

  return (
    <html lang={lang} dir={dirFor(lang)}>
      <head>
        {/* Fonts are bundled (src/fonts.css). Nothing is fetched from Google at
            runtime: it is slow from Iran, and a blocked stylesheet dropped the
            whole UI to a system font part-way through loading. */}
        <style>{"html,body{background:#0a0a0b}"}</style>
        {/* Start the DNS+TCP+TLS chain for the runtime third-party origins during
            parse instead of serially after it. On a high-latency connection the
            handshakes, not the bytes, are the expensive part. */}
        <link rel="preconnect" href="https://telegram.org" crossOrigin="" />
        <link rel="preconnect" href="https://api.kie.ai" crossOrigin="" />
        <link rel="preconnect" href="https://file.aiquickdraw.com" crossOrigin="" />
      </head>
      <body>
        <Providers initialLang={lang}>{children}</Providers>
        {/* `afterInteractive`, and the reason is the same one that made this
            `defer` in index.html: telegram.org is filtered in Iran, where a
            blocked connection typically hangs rather than resets. A
            `beforeInteractive` script is injected ahead of the app and would
            hold the whole page on a bare background for the OS TCP timeout.
            Everything that reads window.Telegram already treats it as optional. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
