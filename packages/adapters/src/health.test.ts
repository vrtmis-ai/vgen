import { describe, expect, it, vi } from "vitest";
import { RedisHealthAdapter, S3StorageHealthAdapter } from "./health";

describe("infrastructure health adapters", () => {
  it("accepts Redis only when the server replies PONG", async () => {
    const disconnect = vi.fn();
    const adapter = new RedisHealthAdapter(() => ({
      connect: vi.fn(async () => undefined),
      ping: vi.fn(async () => "PONG"),
      disconnect,
    }));

    await expect(adapter.ping()).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("rejects an unexpected Redis response and still disconnects", async () => {
    const disconnect = vi.fn();
    const adapter = new RedisHealthAdapter(() => ({
      connect: vi.fn(async () => undefined),
      ping: vi.fn(async () => "NOPE"),
      disconnect,
    }));

    await expect(adapter.ping()).rejects.toThrow("unexpected response");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("checks object storage through its S3 API", async () => {
    const send = vi.fn(async () => ({}));
    const adapter = new S3StorageHealthAdapter({ send });

    await expect(adapter.ping()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
  });
});
