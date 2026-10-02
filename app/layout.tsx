import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "../src/index.css";
import { CookieConsent } from "../src/components/CookieConsent";
import { CONSENT_COOKIE } from "../src/lib/cookies";
import { dirFor, LANG_COOKIE, parseLang } from "../src/lib/lang";
import { Providers } from "./providers";

/** Arabic and Latin subsets of the variable Vazirmatn. One file per script
    covers every weight, so these two are the whole font for a Persian page. */
const VAZIRMATN_FIRST_PAINT = ["/fonts/v16-Dxxo8j6PP2D_kU2muijlGMWWMmk.woff2", "/fonts/v16-Dxxo8j6PP2D_kU2muijlHcWW.woff2"];

export const metadata: Metadata = {
  // ponytail: eNamad's title check, temporary. Back to "DEEV" once the domain is verified.
  title: "38669407",
  /* The mark, in the three forms the platforms actually ask for: the SVG for
     browsers that take one, a 32px PNG for the ones that do not, and the 180px
     tile iOS uses when the site is kept on a home screen. All three are the
     same traced artwork — see `src/components/brandMarks.tsx`. */
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0c0d",
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
        <style>{"html,body{background:#0e1012}"}</style>
        {/* eNamad's domain check reads this from the homepage's first HTML
            response. Written in the head directly rather than through
            `metadata`, which Next may stream in after the head. The empty
            public/38669407.txt is the same check's other accepted proof. */}
        <meta name="enamad" content="11292457" />
        {/* The two faces a Persian first paint uses, fetched alongside the
            stylesheet instead of after it. Without this the browser cannot know
            it needs them until the 134 KB stylesheet has been parsed, and the
            cookie notice — the LCP element for every first visit — waited on
            that chain: HTML, then CSS, then font, finishing at 3.7 s on slow
            4G. Persian only: English text is set in Inter, and a preload for a
            font the page never uses is a warning and wasted bandwidth. */}
        {lang === "fa" &&
          VAZIRMATN_FIRST_PAINT.map((href) => <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="" />)}
      </head>
      <body>
        <Providers initialLang={lang}>{children}</Providers>
        <CookieConsent initial={consent} />
      </body>
    </html>
  );
}
