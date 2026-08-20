import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../runtime/apiError";
import type { AdminApi } from "../../features/admin/adminApi";
import { AdminConsole } from "./AdminConsole";

/**
 * The panel this replaces wrote to localStorage and had never called the API,
 * so there was nothing to hold it to. These tests hold the new one to the three
 * things that would be dangerous to get wrong:
 *
 *   1. A 404 is the signed-out state. The whole staff surface answers 404 to
 *      anyone without a session so its existence is not confirmed — if the
 *      panel treated that as a failure it would show an error screen to every
 *      person who has simply not signed in yet.
 *   2. A password is not a session. The server answers 202 and authorises
 *      nothing until a second factor lands, and the panel must not render a
 *      single section in between.
 *   3. Sections are gated on permissions, not on being staff.
 */

const notFound = () => new ApiError({ code: "not_found", message: "Not found.", status: 404 });

let api: AdminApi;
let sessionState: Awaited<ReturnType<AdminApi["getSession"]>> | null;

function stubApi(): AdminApi {
  return {
    getSession: vi.fn(async () => {
      if (!sessionState) throw notFound();
      return sessionState;
    }),
    signIn: vi.fn(async () => {
      sessionState = { status: "mfa_required", email: "admin@deev.test", roles: ["admin"], permissions: [] };
    }),
    submitSecondFactor: vi.fn(async (code: string) => {
      if (code !== "111111") throw new ApiError({ code: "mfa_invalid", message: "no", status: 403 });
      sessionState = { status: "authed", email: "admin@deev.test", roles: ["admin"], permissions: ["*"] };
      return { roles: ["admin"], permissions: ["*"] };
    }),
    signOut: vi.fn(async () => {
      sessionState = null;
    }),
    listProviders: vi.fn(async () => ({
      providers: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          code: "wavespeed",
          name: "WaveSpeed",
          baseUrl: "https://api.wavespeed.ai",
          isActive: true,
          hasAdapter: true,
          unitCostUsd: 1,
          credentials: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              label: "wavespeed-primary",
              secretRef: "WAVESPEED_API_KEY",
              configured: false,
              isActive: true,
              dailyRequestCap: null,
              lastUsedAt: null,
            },
          ],
        },
      ],
    })),
    patchProvider: vi.fn(async () => undefined),
    listModels: vi.fn(async () => ({
      models: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          variantId: "qwen-image",
          familyId: "qwen",
          name: "Qwen Image",
          modality: "image" as const,
          isActive: true,
          homeProviderCode: "kie",
          homeExternalModelId: "qwen/image",
          servingProviderCode: "kie",
          servingExternalModelId: "qwen/image",
          routeCount: 1,
          activeRouteCount: 0,
        },
      ],
      servingModels: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          providerId: "11111111-1111-4111-8111-111111111111",
          providerCode: "wavespeed",
          externalModelId: "wavespeed-ai/qwen-image/text-to-image",
          name: "Qwen Image (WaveSpeed)",
          modality: "image" as const,
          isActive: true,
        },
      ],
    })),
    listRoutes: vi.fn(async () => ({ routes: [] })),
    replaceRoutes: vi.fn(async () => ({ routes: [] })),
    clearRoutes: vi.fn(async () => undefined),
    listInvites: vi.fn(async () => []),
    createInvite: vi.fn(async () => []),
    removeInvite: vi.fn(async () => "deleted" as const),
    listPromos: vi.fn(async () => []),
    createPromo: vi.fn(async () => undefined),
    removePromo: vi.fn(async () => "deleted" as const),
    getEarlyAccess: vi.fn(async () => true),
    setEarlyAccess: vi.fn(async (value: boolean) => value),
  };
}

vi.mock("../../features/admin/useAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../features/admin/useAdmin")>("../../features/admin/useAdmin");
  return { ...actual, useAdminAvailability: () => ({ available: true, api }) };
});

function renderConsole() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminConsole />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionState = null;
  api = stubApi();
});
afterEach(() => vi.restoreAllMocks());

describe("the admin console", () => {
  it("treats the surface's 404 as signed out rather than as an error", async () => {
    renderConsole();

    // The whole staff API answers 404 to a stranger on purpose. An error screen
    // here would mean every operator saw a failure before every sign-in.
    expect(await screen.findByRole("heading", { name: "ورود کارکنان" })).toBeInTheDocument();
    expect(screen.queryByText("خطا")).not.toBeInTheDocument();
  });

  it("renders nothing of the panel between the password and the second factor", async () => {
    const user = userEvent.setup();
    renderConsole();
    await screen.findByRole("heading", { name: "ورود کارکنان" });

    await user.type(screen.getByLabelText("ایمیل"), "admin@deev.test");
    await user.type(screen.getByLabelText("گذرواژه"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "ادامه" }));

    // The server has set a cookie by now, and it authorises nothing.
    expect(await screen.findByLabelText("کد تأیید دومرحله‌ای")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "مسیر مدل‌ها" })).not.toBeInTheDocument();
    expect(api.listProviders).not.toHaveBeenCalled();
  });

  it("says the code was wrong without ending the half-finished session", async () => {
    const user = userEvent.setup();
    renderConsole();
    await screen.findByRole("heading", { name: "ورود کارکنان" });
    await user.type(screen.getByLabelText("ایمیل"), "admin@deev.test");
    await user.type(screen.getByLabelText("گذرواژه"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "ادامه" }));

    await user.type(await screen.findByLabelText("کد تأیید دومرحله‌ای"), "000000");
    await user.click(screen.getByRole("button", { name: "تأیید" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("کد درست نیست.");
    expect(screen.getByLabelText("کد تأیید دومرحله‌ای")).toBeInTheDocument();
  });

  it("opens the panel once the second factor lands", async () => {
    const user = userEvent.setup();
    renderConsole();
    await screen.findByRole("heading", { name: "ورود کارکنان" });
    await user.type(screen.getByLabelText("ایمیل"), "admin@deev.test");
    await user.type(screen.getByLabelText("گذرواژه"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "ادامه" }));
    await user.type(await screen.findByLabelText("کد تأیید دومرحله‌ای"), "111111");
    await user.click(screen.getByRole("button", { name: "تأیید" }));

    expect(await screen.findByRole("heading", { name: "پنل مدیریت" })).toBeInTheDocument();
  });

  it("hides a section the role cannot read, rather than disabling it", async () => {
    // A disabled control is still an invitation to find out who can press it.
    sessionState = { status: "authed", email: "content@deev.test", roles: ["content"], permissions: ["invites.read"] };
    renderConsole();

    await screen.findByRole("heading", { name: "پنل مدیریت" });
    expect(screen.getByRole("button", { name: "دعوت و تخفیف" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "مسیر مدل‌ها" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ارائه‌دهنده‌ها" })).not.toBeInTheDocument();
  });

  it("shows a read-only routing section to someone who cannot write", async () => {
    sessionState = { status: "authed", email: "support@deev.test", roles: ["support"], permissions: ["catalog.read"] };
    renderConsole();
    await screen.findByRole("heading", { name: "پنل مدیریت" });

    await userEvent.setup().click(await screen.findByRole("button", { name: "Qwen Image" }));

    expect(await screen.findByText(/catalog\.write/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ذخیره" })).not.toBeInTheDocument();
  });

  it("names the key a provider wants without ever holding its value", async () => {
    sessionState = { status: "authed", email: "admin@deev.test", roles: ["admin"], permissions: ["*"] };
    renderConsole();
    await screen.findByRole("heading", { name: "پنل مدیریت" });

    await userEvent.setup().click(screen.getByRole("button", { name: "ارائه‌دهنده‌ها" }));

    // The variable's NAME, and whether it is set. The value has never left the
    // server, and this row is the difference between "misconfigured" and
    // "broken" — the most common reason a newly routed model refuses to run.
    expect(await screen.findByText("WAVESPEED_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("not set")).toBeInTheDocument();
  });

  it("refuses to send two active routes that share a priority", async () => {
    // The server refuses this too, and the database index refuses it under
    // that — but a message naming the problem beats a constraint name.
    const user = userEvent.setup();
    sessionState = { status: "authed", email: "admin@deev.test", roles: ["admin"], permissions: ["*"] };
    renderConsole();
    await screen.findByRole("heading", { name: "پنل مدیریت" });
    await user.click(await screen.findByRole("button", { name: "Qwen Image" }));

    await user.click(await screen.findByRole("button", { name: "افزودن مسیر" }));
    await user.click(screen.getByRole("button", { name: "افزودن مسیر" }));

    const targets = screen.getAllByLabelText("مدل مقصد");
    const priorities = screen.getAllByLabelText("اولویت");
    const actives = screen.getAllByRole("checkbox");
    for (const [index, select] of targets.entries()) {
      await user.selectOptions(select, "44444444-4444-4444-8444-444444444444");
      await user.clear(priorities[index]!);
      await user.type(priorities[index]!, "10");
      await user.click(actives[index]!);
    }

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ذخیره" })).toBeDisabled();
    expect(api.replaceRoutes).not.toHaveBeenCalled();
  });

  it("adds a route switched off, because nobody has proved it yet", async () => {
    const user = userEvent.setup();
    sessionState = { status: "authed", email: "admin@deev.test", roles: ["admin"], permissions: ["*"] };
    renderConsole();
    await screen.findByRole("heading", { name: "پنل مدیریت" });
    await user.click(await screen.findByRole("button", { name: "Qwen Image" }));

    await user.click(await screen.findByRole("button", { name: "افزودن مسیر" }));

    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("drops every cached staff payload on sign-out", async () => {
    const user = userEvent.setup();
    sessionState = { status: "authed", email: "admin@deev.test", roles: ["admin"], permissions: ["*"] };
    renderConsole();
    await screen.findByRole("heading", { name: "پنل مدیریت" });
    await user.click(screen.getByRole("button", { name: "ارائه‌دهنده‌ها" }));
    await screen.findByText("WAVESPEED_API_KEY");

    await user.click(screen.getByRole("button", { name: "خروج" }));
    await waitFor(() => expect(api.signOut).toHaveBeenCalled());

    // Not just the session: a panel that kept its provider list would hand the
    // next person at that desk the credential names and the routing table.
    await waitFor(() => expect(screen.getByRole("heading", { name: "ورود کارکنان" })).toBeInTheDocument());
    expect(screen.queryByText("WAVESPEED_API_KEY")).not.toBeInTheDocument();
  });
});

describe("permission matching", () => {
  it("honours a wildcard, a section wildcard and an exact grant, and nothing else", async () => {
    const { permits } = await vi.importActual<typeof import("../../features/admin/useAdmin")>("../../features/admin/useAdmin");
    const session = (permissions: string[]) => ({ status: "authed" as const, email: null, roles: [], permissions });

    expect(permits(session(["*"]), "catalog.write")).toBe(true);
    expect(permits(session(["catalog.*"]), "catalog.write")).toBe(true);
    expect(permits(session(["catalog.read"]), "catalog.read")).toBe(true);
    expect(permits(session(["catalog.read"]), "catalog.write")).toBe(false);
    // A half-authenticated session grants nothing, whatever it carries.
    expect(permits({ status: "mfa_required", email: null, roles: [], permissions: ["*"] }, "catalog.read")).toBe(false);
    expect(permits(null, "catalog.read")).toBe(false);
  });
});
