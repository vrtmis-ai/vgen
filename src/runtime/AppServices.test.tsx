import { render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppServicesProvider, type AppServices, useAppServices } from "./AppServices";

const services = {
  session: { getCurrent: vi.fn() },
  auth: {
    startPhoneVerification: vi.fn(),
    verifyPhone: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
    startProviderSignIn: vi.fn(),
    logout: vi.fn(),
  },
  catalog: { list: vi.fn() },
  plans: { list: vi.fn() },
  wallet: { getCurrent: vi.fn() },
  generation: { quote: vi.fn(), create: vi.fn(), getJob: vi.fn() },
  gallery: { list: vi.fn() },
} satisfies AppServices;

function ServiceConsumer() {
  const injected = useAppServices();
  return <span>{injected === services ? "services-ready" : "wrong-services"}</span>;
}

class ExpectedErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  render() {
    return this.state.message ? <span>{this.state.message}</span> : this.props.children;
  }
}

describe("AppServicesProvider", () => {
  it("fails clearly when application services were not installed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const suppressExpectedWindowError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", suppressExpectedWindowError);
    try {
      render(
        <ExpectedErrorBoundary>
          <ServiceConsumer />
        </ExpectedErrorBoundary>,
      );
    } finally {
      window.removeEventListener("error", suppressExpectedWindowError);
    }

    expect(screen.getByText(/App services are not available/)).toBeInTheDocument();
  });

  it("exposes the installed adapters to application features", () => {
    render(
      <AppServicesProvider services={services}>
        <ServiceConsumer />
      </AppServicesProvider>,
    );

    expect(screen.getByText("services-ready")).toBeInTheDocument();
  });
});
