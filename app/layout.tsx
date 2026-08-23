import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "../src/index.css";
import { CookieConsent } from "../src/components/CookieConsent";
import { CONSENT_COOKIE } from "../src/lib/cookies";
import { dirFor, LANG_COOKIE, parseLang } from "../src/lib/lang";
import { PaletteSwitcher } from "../src/components/PaletteSwitcher";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "DEEV",
  icons: { icon: "/favicon.svg" },
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
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  // Read on the server so a returning visitor never sees the notice flash for
  // one frame after hydration.
  const consent = jar.get(CONSENT_COOKIE)?.value;

  return (
    <html lang={lang} dir={dirFor(lang)}>
      <head>
        {/* Fonts are bundled (src/fonts.css). Nothing is fetched from Google at
            runtime: it is slow from Iran, and a blocked stylesheet dropped the
            whole UI to a system font part-way through loading. */}
        <style>{"html,body{background:#0a0a0b}"}</style>
        {/* Start the DNS+TCP+TLS chain for the runtime third-party origins during
            parse instead of serially after it. On a high-latency connection the
            handshakes, not the bytes, are the expensive part.

            Only origins a visitor is *meant* to know about belong here. A
            preconnect is a public statement: it sits in the head of every page,
            it is in view-source before a single script runs, and the browser
            resolves it whether or not the resource is ever used. Two upstream
            hosts were listed here, which told anyone who pressed Ctrl-U which
            company actually renders our models. Whoever adds the next one:
            preconnect is for origins the product depends on openly. */}
        <link rel="preconnect" href="https://telegram.org" crossOrigin="" />
      </head>
      <body>
        <Providers initialLang={lang}>{children}</Providers>
        <CookieConsent initial={consent} />
        {/* TEMPORARY — brand-direction picker. The condition is a build-time
            constant, so a production build folds it to false and drops the
            component from the bundle entirely. Remove with the rest of the
            preview scaffolding once a direction is chosen. */}
        {process.env.NEXT_PUBLIC_APP_MODE === "demo" && <PaletteSwitcher />}
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
