import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import { OAuthFailureNotice } from "./OAuthFailureNotice";

function at(search: string) {
  window.history.replaceState(null, "", `/${search}`);
  return render(
    <LanguageProvider initialLang="en">
      <OAuthFailureNotice />
    </LanguageProvider>,
  );
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("OAuthFailureNotice", () => {
  it("says nothing when the visitor simply arrived", () => {
    at("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains the invite gate and takes the code out of the URL", async () => {
    at("?auth=invite_required");

    expect(screen.getByRole("alert")).toHaveTextContent("invite code");
    // Left in place, a refresh would re-accuse a provider that failed once.
    expect(window.location.search).toBe("");
  });

  it("keeps the rest of the query string", () => {
    at("?ref=twitter&auth=oauth_failed");

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(window.location.search).toBe("?ref=twitter");
  });

  it("falls back rather than going silent on a code it does not know", () => {
    at("?auth=something_new");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("can be dismissed", async () => {
    const user = userEvent.setup();
    at("?auth=account_suspended");

    expect(screen.getByRole("alert")).toHaveTextContent("suspended");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
