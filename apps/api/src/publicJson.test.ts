import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { publicJson } from "./publicJson";

/** A document that counts how many times it has been serialised. */
function counted(value: Record<string, unknown>): { doc: object; count: () => number } {
  let serialised = 0;
  return {
    doc: { toJSON: () => (serialised += 1) && value },
    count: () => serialised,
  };
}

describe("serving a document that is the same for everyone", () => {
  it("sends exactly what the plain route sent, headers included", async () => {
    const document = { families: [{ id: "kling", label: "کلینگ" }], count: 2 };
    const app = Fastify({ logger: false });
    const send = publicJson<typeof document>();
    app.get("/plain", async () => document);
    app.get("/cached", async (_request, reply) => send(reply, document));

    const plain = await app.inject({ method: "GET", url: "/plain" });
    const cached = await app.inject({ method: "GET", url: "/cached" });

    expect(cached.body).toBe(plain.body);
    expect(cached.headers["content-type"]).toBe(plain.headers["content-type"]);
    expect(cached.headers["content-length"]).toBe(plain.headers["content-length"]);
  });

  it("serialises once however many readers ask for it", async () => {
    const { doc, count } = counted({ ok: true });
    const app = Fastify({ logger: false });
    const send = publicJson<object>();
    app.get("/d", async (_request, reply) => send(reply, doc));

    for (let i = 0; i < 5; i += 1) await app.inject({ method: "GET", url: "/d" });

    expect(count()).toBe(1);
  });

  /**
   * The load-bearing one. The cache is keyed on the document's identity because
   * `PublicDocument` hands back a fresh object the moment the underlying rows
   * change — so a rebuild must reach the reader on the very next request, with
   * no expiry to wait for.
   */
  it("serves the new document as soon as one is built, not the one it replaced", async () => {
    let current: Record<string, unknown> = { models: 44 };
    const app = Fastify({ logger: false });
    const send = publicJson<Record<string, unknown>>();
    app.get("/d", async (_request, reply) => send(reply, current));

    expect((await app.inject({ method: "GET", url: "/d" })).json()).toEqual({ models: 44 });
    current = { models: 43 };
    expect((await app.inject({ method: "GET", url: "/d" })).json()).toEqual({ models: 43 });
  });

  it("applies the envelope the route asked for", async () => {
    const list = [{ id: "pro" }];
    const app = Fastify({ logger: false });
    const send = publicJson<typeof list>((plans) => ({ plans }));
    app.get("/plans", async (_request, reply) => send(reply, list));

    expect((await app.inject({ method: "GET", url: "/plans" })).json()).toEqual({ plans: [{ id: "pro" }] });
  });
});
