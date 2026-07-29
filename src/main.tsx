import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "./index.css";
import App from "./App";
import { LanguageProvider } from "./lib/i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Host handshake. Telegram is one host among the planned several, so this is a
// per-host setup step rather than something the app depends on — a website or a
// native shell adds its own branch and everything downstream is unchanged.
// Reads the session through lib/session, never window.Telegram, in the app itself.
const tg = (window as { Telegram?: { WebApp?: { ready(): void; expand(): void } } }).Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// index.css carries a prefers-reduced-motion rule, but it only zeroes CSS
// animations and transitions — it cannot touch framer-motion, which drives its
// values from JS. Everything that actually moves here is framer-motion: the
// drifting ambient blobs, the floating logo, the pulsing prompt bar, the hero's
// slow zoom. A user who asked the OS for less motion was still getting all of it.
// reducedMotion="user" makes every motion component honour the setting, and
// still allows opacity fades so transitions do not become instant jump-cuts.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
