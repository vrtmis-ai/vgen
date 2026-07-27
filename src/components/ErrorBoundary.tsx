import { Component, type ErrorInfo, type ReactNode } from "react";

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
    // Console only for now. Once a backend exists this should report to it,
    // because nobody can read a console inside the Telegram client.
    console.error("Unhandled error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-[100dvh] place-items-center bg-surface px-6 text-center">
        <div className="max-w-[320px]">
          <div className="text-[17px] font-semibold text-ink">مشکلی پیش آمد</div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink2">
            بخشی از برنامه از کار افتاد. با بارگذاری دوباره معمولاً درست می‌شود.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn-accent mt-5 rounded-full px-6 py-2.5 text-[14px] font-semibold active:scale-[0.97]"
          >
            بارگذاری دوباره
          </button>
          <details className="mt-5 text-start">
            <summary className="cursor-pointer text-[11.5px] text-ink3">جزئیات فنی</summary>
            <pre className="ltr mt-2 max-h-40 overflow-auto rounded-xl bg-card2 p-3 text-[10.5px] leading-relaxed text-ink3">
              {error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
