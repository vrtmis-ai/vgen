import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { UPLOAD_MAX_BYTES, type ContentEntry } from "@vgen/contracts";
import type { ObjectStore } from "@vgen/adapters";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../plugins/errors";
import { ContentMediaService } from "../contentMedia";
import { registerAdminContentRoutes } from "./adminContent";
import { registerContentRoute } from "./content";

/* ---------------------------------------------------------------------------
   Effects, courses and the prompt bank, from the admin panel.

   The repository is tested against Postgres; here the subject is the edge:
   who may, what a body may hold, and what an upload may be. The uploads run
   through the real ContentMediaService over a fake store, because the type
   and size rules live there and are the point of the upload tests.
   --------------------------------------------------------------------------- */

const ID = "0192f7a0-0000-7000-8000-00000000000a";

const entry: ContentEntry = {
  id: ID,
  kind: "preset",
  status: "published",
  item: {
    id: "fx-1234abcd",
    title: "نور نئون",
    familyId: "seedance",
    seed: "fx-1234abcd",
    prompt: "neon rim light, ",
    openEnded: true,
    kind: "video",
    category: "vfx",
  },
};

const write = {
  kind: "preset",
  status: "published",
  item: { title: "نور نئون", prompt: "neon rim light, ", familyId: "seedance", openEnded: true, kind: "video", category: "vfx" },
};

function appFor(permissions: string[] = ["*"]) {
  const audit = vi.fn(async () => {});
  const content = {
    list: vi.fn(async () => [entry]),
    create: vi.fn(async (): Promise<ContentEntry | "unknown_family"> => entry),
    update: vi.fn(async (): Promise<ContentEntry | "not_found" | "unknown_family"> => entry),
    archive: vi.fn(async (): Promise<{ kind: string; code: string } | null> => ({ kind: "preset", code: "fx-1234abcd" })),
  };
  const put = vi.fn(async (key: string, body: Uint8Array, mimeType: string) => ({
    bucket: "vgen",
    key,
    byteSize: body.byteLength,
    sha256: "x",
    mimeType,
  }));
  const store = {
    put,
    signedUrl: vi.fn(async (key: string) => `https://files.example/${key}?sig=1`),
    delete: vi.fn(),
    ensureBucket: vi.fn(),
    bucket: "vgen",
  } as unknown as ObjectStore;
  const media = new ContentMediaService(store);

  const guard = {
    require: vi.fn(async (_request: unknown, reply: { code(n: number): { send(b: unknown): void } }, permission: string) => {
      if (!permissions.includes("*") && !permissions.includes(permission)) {
        reply.code(403).send({ error: { code: "forbidden" } });
        return null;
      }
      return { userId: "admin-1", permissions, roles: ["admin"], mfaVerified: true, email: null, sessionId: "s1", hasMfa: true } as never;
    }),
    audit,
  };

  const app = Fastify({ logger: false });
  registerErrorHandling(app);
  // The same plugin ceiling createApp sets, so the lesson test proves the
  // route's own ceiling overrides it.
  void app.register(multipart, { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } });
  registerAdminContentRoutes(app, { content, media }, guard as never);
  registerContentRoute(app, { list: vi.fn() as never }, media);
  return { app, audit, content, put };
}

/** `audit_log.target_id` is a uuid column: anything else fails the insert after the write already happened. */
function expectAuditTargetsFitTheColumn(audit: ReturnType<typeof vi.fn>) {
  for (const [, , entry] of audit.mock.calls as unknown as [unknown, unknown, { targetId?: string }][]) {
    if (entry.targetId !== undefined) expect(entry.targetId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
}

function upload(bytes: Buffer) {
  const CRLF = String.fromCharCode(13, 10);
  const boundary = "----deevtest";
  const head = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="x"`,
    "Content-Type: application/octet-stream",
    "",
    "",
  ].join(CRLF);
  return {
    payload: Buffer.concat([Buffer.from(head), bytes, Buffer.from(`${CRLF}--${boundary}--${CRLF}`)]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

const png = (size = 8) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(Math.max(0, size - 8))]);
const mp4 = (size = 16) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(Math.max(0, size - 12))]);
const MB = 1024 * 1024;

describe("editing content", () => {
  it("lists one kind, and only with content.read", async () => {
    const { app, content } = appFor(["content.read"]);

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/content?kind=preset" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ entries: [entry] });
    expect(content.list).toHaveBeenCalledWith("preset");
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/content", payload: write })).statusCode).toBe(403);
  });

  it("creates an effect and audits it under the code the site uses", async () => {
    const { app, audit, content } = appFor();

    const response = await app.inject({ method: "POST", url: "/api/v1/admin/content", payload: write });

    expect(response.statusCode).toBe(201);
    expect(content.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "preset" }), "admin-1");
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: "content.create", targetId: ID, after: expect.objectContaining({ code: "fx-1234abcd" }) }),
    );
  });

  it("refuses an effect with no prompt, or a cover that is not a web link", async () => {
    const { app, content } = appFor();

    const noPrompt = await app.inject({
      method: "POST",
      url: "/api/v1/admin/content",
      payload: { ...write, item: { ...write.item, prompt: " " } },
    });
    const script = await app.inject({
      method: "POST",
      url: "/api/v1/admin/content",
      payload: { ...write, item: { ...write.item, coverUrl: "javascript:alert(1)" } },
    });

    expect(noPrompt.statusCode).toBe(400);
    expect(script.statusCode).toBe(400);
    expect(content.create).not.toHaveBeenCalled();
  });

  it("says so when the model family does not exist", async () => {
    const { app, content } = appFor();
    content.create.mockResolvedValueOnce("unknown_family");

    const response = await app.inject({ method: "POST", url: "/api/v1/admin/content", payload: write });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "unknown_family" } });
  });

  it("answers 404 for an edit to a deleted item or a malformed id", async () => {
    const { app, content } = appFor();
    content.update.mockResolvedValueOnce("not_found");

    expect((await app.inject({ method: "PUT", url: `/api/v1/admin/content/${ID}`, payload: write })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/api/v1/admin/content/not-a-uuid", payload: write })).statusCode).toBe(404);
    expect(content.update).toHaveBeenCalledTimes(1);
  });

  it("archives on delete", async () => {
    const { app, audit } = appFor();

    const response = await app.inject({ method: "DELETE", url: `/api/v1/admin/content/${ID}` });

    expect(response.json()).toEqual({ id: ID, status: "archived" });
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: "content.delete" }));
  });
});

describe("uploading a cover or a lesson", () => {
  it("stores a cover image under content/ and answers with the link the row keeps", async () => {
    const { app, put } = appFor();

    const response = await app.inject({ method: "POST", url: "/api/v1/admin/content/media?purpose=cover", ...upload(png()) });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ kind: "image", url: expect.stringMatching(/^\/api\/v1\/content\/media\/[0-9a-f-]{36}\.png$/) });
    expect(put).toHaveBeenCalledWith(expect.stringMatching(/^content\/[0-9a-f-]{36}\.png$/), expect.anything(), "image/png");
  });

  it("takes a lesson video larger than the customer upload ceiling", async () => {
    const { app } = appFor();

    const response = await app.inject({ method: "POST", url: "/api/v1/admin/content/media?purpose=lesson", ...upload(mp4(16 * MB)) });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ kind: "video", byteSize: 16 * MB });
  });

  it("refuses a cover image over 5MB, and a cover video over 20MB", async () => {
    const { app, put } = appFor();

    const image = await app.inject({ method: "POST", url: "/api/v1/admin/content/media?purpose=cover", ...upload(png(5 * MB + 1)) });
    const video = await app.inject({ method: "POST", url: "/api/v1/admin/content/media?purpose=cover", ...upload(mp4(20 * MB + 1)) });

    expect(image.statusCode).toBe(413);
    expect(video.statusCode).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses a picture as a lesson, and anything that is not a picture or a video", async () => {
    const { app, put } = appFor();

    const picture = await app.inject({ method: "POST", url: "/api/v1/admin/content/media?purpose=lesson", ...upload(png()) });
    const html = await app.inject({
      method: "POST",
      url: "/api/v1/admin/content/media?purpose=cover",
      ...upload(Buffer.from("<html><script>")),
    });

    expect(picture.statusCode).toBe(415);
    expect(html.statusCode).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("serving an upload", () => {
  it("redirects to a fresh signed link for a name it issued", async () => {
    const { app } = appFor();

    const response = await app.inject({ method: "GET", url: `/api/v1/content/media/${ID}.png` });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`https://files.example/content/${ID}.png?sig=1`);
    expect(response.headers["cache-control"]).toBe("public, max-age=1800");
  });

  it("will not sign anything outside content/", async () => {
    const { app } = appFor();

    for (const name of ["..%2Fuploads%2Fx.png", "x.png", `${ID}.html`]) {
      expect((await app.inject({ method: "GET", url: `/api/v1/content/media/${name}` })).statusCode).toBe(404);
    }
  });
});

describe("the audit trail", () => {
  it("only ever names a uuid as the target, whatever was written", async () => {
    const { app, audit } = appFor();

    await app.inject({ method: "POST", url: "/api/v1/admin/content", payload: write });
    await app.inject({ method: "PUT", url: `/api/v1/admin/content/${ID}`, payload: write });
    await app.inject({ method: "DELETE", url: `/api/v1/admin/content/${ID}` });
    await app.inject({ method: "POST", url: "/api/v1/admin/content/media?purpose=cover", ...upload(png()) });

    expect(audit).toHaveBeenCalledTimes(4);
    expectAuditTargetsFitTheColumn(audit);
    expect(audit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: "content.media.upload",
        after: expect.objectContaining({ url: expect.stringMatching(/^\/api\/v1\/content\/media\//) }),
      }),
    );
  });
});
