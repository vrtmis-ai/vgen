import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SystemState } from "./SystemState";

describe("SystemState", () => {
  it("lets the user retry a failed service without reloading the whole app", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<SystemState kind="service" onPrimary={onRetry} requestId="req-42" />);

    expect(screen.getByRole("heading", { name: "ارتباط با سرویس قطع شد" })).toBeInTheDocument();
    expect(screen.getByText("req-42")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
