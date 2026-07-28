import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
