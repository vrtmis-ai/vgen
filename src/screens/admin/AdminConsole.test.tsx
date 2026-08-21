import { render, screen, waitFor, within } from "@testing-library/react";
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

const USER_ROW = {
  id: "77777777-7777-4777-8777-777777777777",
  email: "customer@example.test",
  handle: "customer",
  displayName: "A Customer",
  createdAt: 1_780_000_000_000,
  coinsBalance: 120,
  coinsHeld: 0,
  coinsPurchased: 500,
  coinsSpent: 380,
  jobs: 40,
  providerCostUsd: 12.5,
  lastJobAt: 1_787_000_000_000,
  activeBans: 0,
};

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
    createProvider: vi.fn(async () => undefined),
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
          providerName: "WaveSpeed",
          externalModelId: "wavespeed-ai/qwen-image/text-to-image",
          name: "Qwen Image (WaveSpeed)",
          modality: "image" as const,
          isActive: true,
        },
        {
          id: "55555555-5555-4555-8555-555555555555",
          providerId: "11111111-1111-4111-8111-111111111111",
          providerCode: "wavespeed",
          providerName: "WaveSpeed",
          externalModelId: "bytedance/seedance-2.0-fast/text-to-video",
          name: "Seedance 2.0 Fast (WaveSpeed)",
          modality: "video" as const,
          isActive: true,
        },
      ],
    })),
    createServingModel: vi.fn(async () => undefined),
    listRoutes: vi.fn(async () => ({ routes: [] })),
    replaceRoutes: vi.fn(async () => ({ routes: [] })),
    routeTo: vi.fn(async () => ({ routes: [] })),
    clearRoutes: vi.fn(async () => undefined),
    listInvites: vi.fn(async () => []),
    createInvite: vi.fn(async () => []),
    removeInvite: vi.fn(async () => "deleted" as const),
    listPromos: vi.fn(async () => []),
    createPromo: vi.fn(async () => undefined),
    removePromo: vi.fn(async () => "deleted" as const),
    getOverview: vi.fn(async () => ({
      window: "30d",
      totals: {
        coinsSold: 2400,
        coinsGranted: 300,
        coinsSpent: 1800,
        revenueIrr: 0,
        revenueUsd: 0,
        providerCostUsd: 12.5,
        // No gateway yet, so there is genuinely nothing to compare a cost to.
        grossMarginUsd: null,
        jobs: 40,
        jobsSucceeded: 38,
        jobsFailed: 2,
        activeUsers: 6,
        newUsers: 3,
      },
      standing: { coinsOutstanding: 900, coinsHeld: 20, users: 11, bannedUsers: 1 },
      daily: [
        { day: "2026-08-20", jobs: 18, coinsSpent: 800, providerCostUsd: 5.5, newUsers: 1 },
        { day: "2026-08-21", jobs: 22, coinsSpent: 1000, providerCostUsd: 7, newUsers: 2 },
      ],
    })),
    listModelMargin: vi.fn(async () => [
      {
        variantId: "qwen-image",
        name: "Qwen Image",
        providerCode: "kie",
        jobs: 40,
        succeeded: 38,
        failed: 2,
        coinsCharged: 1800,
        providerCostUsd: 12.5,
        avgSeconds: 4.2,
      },
    ]),
    listProviderHealth: vi.fn(async () => [
      {
        providerCode: "kie",
        providerName: "KIE",
        attempts: 41,
        succeeded: 38,
        failed: 3,
        avgLatencyMs: 3100,
        providerCostUsd: 12.5,
      },
    ]),
    listUsers: vi.fn(async () => ({ users: [USER_ROW], total: 1, limit: 25, offset: 0 })),
    getUser: vi.fn(async () => ({
      user: { ...USER_ROW, recentJobs: [], recentLedger: [] },
      bans: [],
    })),
    adjustCredits: vi.fn(async () => undefined),
    banUser: vi.fn(async () => undefined),
    liftBan: vi.fn(async () => []),
    revokeUserSessions: vi.fn(async () => 2),
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

    const routingUser = userEvent.setup();
    await routingUser.click(await screen.findByRole("button", { name: "مسیر مدل‌ها" }));
    await routingUser.click(await screen.findByRole("button", { name: "Qwen Image" }));

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
    await user.click(await screen.findByRole("button", { name: "مسیر مدل‌ها" }));
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
    await user.click(await screen.findByRole("button", { name: "مسیر مدل‌ها" }));
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

/**
 * The routing picker.
 *
 * These cover the thing that made the old one unusable rather than the plumbing
 * behind it. A flat list of `bytedance/seedance-2.0-fast/text-to-video` reads as
 * a pile of model names unless something says which provider runs it, and the
 * whole question this screen answers is *which provider*.
 */
describe("choosing where a model runs", () => {
  const signedIn = () => {
    sessionState = { status: "authed", email: "admin@deev.test", roles: ["admin"], permissions: ["*"] };
  };

  it("groups destinations under the provider's name, not its code", async () => {
    signedIn();
    renderConsole();
    await screen.findByRole("heading", { name: "پنل مدیریت" });
    await userEvent.setup().click(await screen.findByRole("button", { name: "مسیر مدل‌ها" }));

    const select = await screen.findByLabelText("انتقال Qwen Image");
    // An <optgroup> is a group, and its label is what an admin actually reads.
    expect(within(select).getByRole("group", { name: "WaveSpeed" })).toBeInTheDocument();
  });

  it("does not offer a video endpoint as somewhere to send an image variant", async () => {
    signedIn();
    renderConsole();
    await screen.findByRole("heading", { name: "پنل مدیریت" });
    await userEvent.setup().click(await screen.findByRole("button", { name: "مسیر مدل‌ها" }));

    const select = await screen.findByLabelText("انتقال Qwen Image");
    expect(within(select).getByRole("option", { name: "wavespeed-ai/qwen-image/text-to-image" })).toBeInTheDocument();
    // Not a preference anyone holds — a typo that every job would fail on.
    expect(within(select).queryByRole("option", { name: "bytedance/seedance-2.0-fast/text-to-video" })).not.toBeInTheDocument();
  });

  it("moves the model in one choice", async () => {
    signedIn();
    const user = userEvent.setup();
    renderConsole();
    await screen.findByRole("heading", { name: "پنل مدیریت" });
    await user.click(await screen.findByRole("button", { name: "مسیر مدل‌ها" }));

    await user.selectOptions(await screen.findByLabelText("انتقال Qwen Image"), "44444444-4444-4444-8444-444444444444");

    await waitFor(() =>
      expect(api.routeTo).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"),
    );
    // The one-click path must never go through the whole-list replace: that
    // would send `paramOverrides: {}` and strip the translation the destination
    // needs to accept the request at all.
    expect(api.replaceRoutes).not.toHaveBeenCalled();
  });

  it("sends the model home by clearing its routes, not by routing it to itself", async () => {
    signedIn();
    const user = userEvent.setup();
    renderConsole();
    await screen.findByRole("heading", { name: "پنل مدیریت" });
    await user.click(await screen.findByRole("button", { name: "مسیر مدل‌ها" }));

    await user.selectOptions(await screen.findByLabelText("انتقال Qwen Image"), "");

    await waitFor(() => expect(api.clearRoutes).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333"));
    expect(api.routeTo).not.toHaveBeenCalled();
  });

  it("refuses a provider key named for the browser bundle", async () => {
    const { AdminProviderCreateSchema } =
      await vi.importActual<typeof import("../../runtime/contracts/admin")>("../../runtime/contracts/admin");
    const base = { code: "example", name: "Example", creditUnitName: "credit" };

    expect(AdminProviderCreateSchema.safeParse({ ...base, secretRef: "EXAMPLE_API_KEY" }).success).toBe(true);
    // NEXT_PUBLIC_ is inlined into the client at build time and this repository
    // is public, so a key named this way would be published, not leaked.
    expect(AdminProviderCreateSchema.safeParse({ ...base, secretRef: "NEXT_PUBLIC_EXAMPLE_API_KEY" }).success).toBe(false);
    // Not an env var name the shell could export, so it could never be set.
    expect(AdminProviderCreateSchema.safeParse({ ...base, secretRef: "example-api-key" }).success).toBe(false);
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

/**
 * The dashboard and the customer list.
 *
 * A dashboard is believed, which is what makes it worth testing. A wrong
 * routing table is found by the next job failing; a wrong number here is found
 * in a meeting, if at all. These cover the two places this one is most likely
 * to mislead somebody, plus the permission split that keeps the customer list
 * from riding along with the charts.
 */
describe("the dashboard", () => {
  const signedIn = (permissions: string[] = ["*"]) => {
    sessionState = { status: "authed", email: "admin@deev.test", roles: ["admin"], permissions };
  };

  it("opens on the dashboard rather than making you find it", async () => {
    signedIn();
    renderConsole();

    await screen.findByRole("heading", { name: "پنل مدیریت" });
    // "How are we doing" is answered before anybody clicks anything.
    expect(await screen.findByText("سکه‌ی فروخته‌شده")).toBeInTheDocument();
    await waitFor(() => expect(api.getOverview).toHaveBeenCalledWith("30d"));
  });

  it("keeps coins sold apart from coins given away", async () => {
    signedIn();
    renderConsole();

    // Both arrive through grant_credits and both land as entry_type 'grant';
    // only the lot's source tells them apart. Merging them is how a promo
    // campaign reads as a good quarter.
    expect(await screen.findByText("2,400")).toBeInTheDocument();
    expect(await screen.findByText("300")).toBeInTheDocument();
  });

  it("says there is no margin rather than drawing a negative one", async () => {
    signedIn();
    renderConsole();

    // There is no payment gateway, so revenue is legitimately zero. A large
    // negative number would read as a business losing money rather than as one
    // that has not opened.
    expect(await screen.findByText("تا وقتی فروشی نباشد، حاشیه‌ای هم نیست")).toBeInTheDocument();
    expect(await screen.findByText("هنوز درگاه پرداخت وصل نیست")).toBeInTheDocument();
  });

  it("does not refetch a window it has already seen", async () => {
    signedIn();
    const user = userEvent.setup();
    renderConsole();
    await screen.findByText("سکه‌ی فروخته‌شده");

    await user.click(screen.getByRole("button", { name: "امروز" }));
    await waitFor(() => expect(api.getOverview).toHaveBeenCalledWith("today"));
    await user.click(screen.getByRole("button", { name: "۳۰ روز" }));

    // The window is part of the query key, so going back is instant and
    // offline — comparing two windows is the actual thing this screen is for.
    await waitFor(() => expect(api.getOverview).toHaveBeenCalledTimes(2));
  });
});

describe("the customer list", () => {
  const signedIn = (permissions: string[]) => {
    sessionState = { status: "authed", email: "admin@deev.test", roles: ["admin"], permissions };
  };

  const openCustomer = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: "کاربران" }));
    await user.click(await screen.findByRole("button", { name: "customer@example.test" }));
  };

  it("needs users.read on top of analytics.read", async () => {
    // Somebody can have the money dashboard without the mailing list. That
    // distinction cannot be recovered once one permission covers both.
    signedIn(["analytics.read"]);
    renderConsole();

    await screen.findByRole("heading", { name: "پنل مدیریت" });
    expect(screen.getByRole("button", { name: "داشبورد" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "کاربران" })).not.toBeInTheDocument();
  });

  it("shows it once both permissions are held", async () => {
    signedIn(["analytics.read", "users.read"]);
    renderConsole();

    await screen.findByRole("heading", { name: "پنل مدیریت" });
    expect(await screen.findByRole("button", { name: "کاربران" })).toBeInTheDocument();
  });

  it("opens a customer and offers no actions without the permissions for them", async () => {
    signedIn(["analytics.read", "users.read"]);
    const user = userEvent.setup();
    renderConsole();
    await openCustomer(user);

    expect(await screen.findByText("خرج کرده")).toBeInTheDocument();
    // A disabled field is still an invitation to find out who can use it.
    expect(screen.queryByLabelText("تعداد سکه")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("دامنه‌ی مسدودی")).not.toBeInTheDocument();
  });

  it("will not move a balance without a reason", async () => {
    signedIn(["*"]);
    const user = userEvent.setup();
    renderConsole();
    await openCustomer(user);

    await user.type(await screen.findByLabelText("تعداد سکه"), "50");
    await user.click(screen.getByRole("button", { name: "ثبت" }));

    // The ledger is append-only at the database, so an unexplained entry is a
    // permanent mystery. The note is not optional.
    expect(api.adjustCredits).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("دلیل اصلاح"), "goodwill after a failed batch");
    await user.click(screen.getByRole("button", { name: "ثبت" }));
    await waitFor(() => expect(api.adjustCredits).toHaveBeenCalledWith(USER_ROW.id, { coins: 50, note: "goodwill after a failed batch" }));
  });

  it("passes a negative adjustment through unchanged", async () => {
    signedIn(["*"]);
    const user = userEvent.setup();
    renderConsole();
    await openCustomer(user);

    await user.type(await screen.findByLabelText("تعداد سکه"), "-30");
    await user.type(screen.getByLabelText("دلیل اصلاح"), "duplicate grant, reversing");
    await user.click(screen.getByRole("button", { name: "ثبت" }));

    // The server refuses to overdraw. The panel must not quietly clamp first,
    // or that refusal never happens and a wrong number is written instead.
    await waitFor(() => expect(api.adjustCredits).toHaveBeenCalledWith(USER_ROW.id, { coins: -30, note: "duplicate grant, reversing" }));
  });

  it("defaults a ban to generation rather than to the whole platform", async () => {
    signedIn(["*"]);
    const user = userEvent.setup();
    renderConsole();
    await openCustomer(user);

    // The narrow one. A platform ban is a bigger decision than the default
    // option on a dropdown should be making for somebody.
    expect(await screen.findByLabelText("دامنه‌ی مسدودی")).toHaveValue("generation");
    await user.click(screen.getByRole("button", { name: "مسدود کن" }));
    await waitFor(() => expect(api.banUser).toHaveBeenCalledWith(USER_ROW.id, { scope: "generation" }));
  });
});
