import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationProvider, useNavigation } from "./NavigationProvider";

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
let pathname = "/studio/video";

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname,
}));

function BackButton() {
  const { goBack } = useNavigation();
  return <button onClick={goBack}>back</button>;
}

function renderAt(path: string) {
  pathname = path;
  return render(
    <NavigationProvider>
      <BackButton />
    </NavigationProvider>,
  );
}

/**
 * `goBack` replaces react-router's `location.key === "default"` check, which App
 * Router has no equivalent for. Getting it wrong is not cosmetic: calling
 * router.back() on a cold deep link walks the user out of the site entirely.
 */
describe("goBack on a history-less entry", () => {
  beforeEach(() => {
    router.push.mockClear();
    router.replace.mockClear();
    router.back.mockClear();
  });

  it("replaces with the default workspace when the app was entered directly", async () => {
    const user = userEvent.setup();
    renderAt("/result/abc");

    await user.click(screen.getByRole("button", { name: "back" }));

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/studio/video");
  });

  it("goes back once the user has navigated inside the app", async () => {
    const user = userEvent.setup();
    const { rerender } = renderAt("/studio/image");

    // A second pathname is what an in-app navigation looks like to the provider.
    pathname = "/result/abc";
    rerender(
      <NavigationProvider>
        <BackButton />
      </NavigationProvider>,
    );
    await user.click(screen.getByRole("button", { name: "back" }));

    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("survives a re-render at the same path", async () => {
    const user = userEvent.setup();
    const { rerender } = renderAt("/generate/kling-3");

    // StrictMode double-invokes effects on mount, and any re-render replays
    // them. A counter would read >1 here and wrongly call back().
    rerender(
      <NavigationProvider>
        <BackButton />
      </NavigationProvider>,
    );
    await user.click(screen.getByRole("button", { name: "back" }));

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/studio/video");
  });
});
