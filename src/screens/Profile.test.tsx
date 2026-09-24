import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createDemoServices } from "../adapters/demo/demoServices";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { LanguageProvider } from "../lib/i18n";
import { AppServicesProvider } from "../runtime/AppServices";
import type { AccountUser } from "../runtime/contracts/session";
import Profile from "./Profile";

/**
 * Driven against the demo adapter, like the auth screen, so the refusals under
 * test are the ones a port actually models rather than this file's idea of them.
 */

const USER: AccountUser = {
  id: "u1",
  methods: ["email"],
  emailNormalized: "person@example.test",
  handle: "before.name",
  displayName: "Person",
  locale: "fa",
};

function renderProfile(user: AccountUser = USER) {
  const services = createDemoServices({ startAnonymous: false });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LanguageProvider initialLang="en">
        <AppServicesProvider services={services}>
          <CatalogProvider families={[]}>
            <Profile
              account={user}
              wallet={{ spendable: 100, grants: [] }}
              gens={[]}
              onWallet={vi.fn()}
              onBack={vi.fn()}
              onGallery={vi.fn()}
              onOpenModel={vi.fn()}
              onSignOut={vi.fn()}
            />
          </CatalogProvider>
        </AppServicesProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return services;
}

describe("the profile screen", () => {
  it("credits you by the username the community feed uses", async () => {
    renderProfile();

    expect(screen.getByText("@before.name")).toBeInTheDocument();
  });

  it("changes the username, which nothing could do before", async () => {
    const user = userEvent.setup();
    const services = renderProfile();
    const updateProfile = vi.spyOn(services.auth, "updateProfile");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const field = screen.getByLabelText("Username");
    await user.clear(field);
    await user.type(field, "After.Name");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Lowercased on the way out, so the field showed the name that gets made.
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ handle: "after.name" }));
  });

  it("sends only what moved, so an unchanged field is not an instruction", async () => {
    const user = userEvent.setup();
    const services = renderProfile();
    const updateProfile = vi.spyOn(services.auth, "updateProfile");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Someone Else");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ displayName: "Someone Else" }));
  });

  it("will not send a name that is not one", async () => {
    const user = userEvent.setup();
    const services = renderProfile();
    const updateProfile = vi.spyOn(services.auth, "updateProfile");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Username"));
    await user.type(screen.getByLabelText("Username"), "no spaces");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("reports a taken username as taken", async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Username"));
    await user.type(screen.getByLabelText("Username"), "taken");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That username is taken. Pick another.");
  });
});
