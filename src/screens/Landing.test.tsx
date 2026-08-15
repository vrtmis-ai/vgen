import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import Landing from "./Landing";

// English, so the button assertions below read as the labels a reviewer sees.
// This used to be seeded through localStorage; language now arrives as a prop
// from the server, which is what lets <html dir> be correct in the first byte.
describe("Landing authentication actions", () => {
  it("renders the DEEV product name", () => {
    render(
      <LanguageProvider initialLang="en">
        <Landing onSignIn={vi.fn()} onSignUp={vi.fn()} />
      </LanguageProvider>,
    );

    expect(within(screen.getByRole("banner")).getByText("DEEV")).toBeInTheDocument();
  });

  it("keeps sign in and sign up as distinct actions", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    const onSignUp = vi.fn();

    render(
      <LanguageProvider initialLang="en">
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
