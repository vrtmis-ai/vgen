import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import Landing from "./Landing";

describe("Landing authentication actions", () => {
  it("renders the DEEV product name", () => {
    localStorage.setItem("vgen-lang", '"en"');

    render(
      <LanguageProvider>
        <Landing onSignIn={vi.fn()} onSignUp={vi.fn()} />
      </LanguageProvider>,
    );

    expect(within(screen.getByRole("banner")).getByText("DEEV")).toBeInTheDocument();
  });

  it("keeps sign in and sign up as distinct actions", async () => {
    localStorage.setItem("vgen-lang", '"en"');
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    const onSignUp = vi.fn();

    render(
      <LanguageProvider>
        <Landing onSignIn={onSignIn} onSignUp={onSignUp} />
      </LanguageProvider>,
    );

    const navigation = screen.getByRole("banner");
    await user.click(within(navigation).getByRole("button", { name: "Log in" }));

    expect(onSignIn).toHaveBeenCalledOnce();
    expect(onSignUp).not.toHaveBeenCalled();

    await user.click(within(navigation).getByRole("button", { name: "Start free" }));

    expect(onSignIn).toHaveBeenCalledOnce();
    expect(onSignUp).toHaveBeenCalledOnce();
  });
});
