import { Component, type ErrorInfo, type ReactNode } from "react";
import { ApiError } from "../adapters/http/client";
import { reportCrash } from "../runtime/telemetry";
import { SystemState } from "./SystemState";

// A throw anywhere below React's root unmounts the whole tree and leaves a blank
// page — no message, no way back, nothing in the UI to report. Inside Telegram
// there isn't even a browser console to look at. This catches it and offers a
// reload; the details stay collapsed so the fallback still reads as the app.

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportCrash(error);
    if (process.env.NODE_ENV !== "production") console.error("Unhandled error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const requestId = error instanceof ApiError ? error.requestId : undefined;

    return (
      <SystemState
        kind="service"
        title="مشکلی در این بخش پیش آمد"
        description="خطای غیرمنتظره‌ای رخ داد و برای جلوگیری از خراب‌شدن داده‌ها این بخش متوقف شد. بارگذاری دوباره معمولاً مشکل را برطرف می‌کند."
        primaryLabel="بارگذاری دوباره"
        onPrimary={() => window.location.reload()}
        onSecondary={() => window.history.back()}
        requestId={requestId}
      />
    );
  }
}
