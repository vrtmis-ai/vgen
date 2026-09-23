import {
  ContentMediaPurposeSchema,
  ContentWriteSchema,
  EditableContentKindSchema,
  type ContentEntry,
  type ContentMedia,
  type ContentMediaPurpose,
  type ContentWrite,
  type EditableContentKind,
} from "@vgen/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ContentMediaError, contentMediaCeiling } from "../contentMedia";
import type { AdminGuard } from "./admin";

export interface AdminContentDependencies {
  content: {
    list(kind: EditableContentKind): Promise<ContentEntry[]>;
    create(write: ContentWrite, userId: string): Promise<ContentEntry | "unknown_family">;
    update(id: string, write: ContentWrite, userId: string): Promise<ContentEntry | "not_found" | "unknown_family">;
    archive(id: string, userId: string): Promise<{ kind: string; code: string } | { inUse: number } | null>;
    move(id: string, direction: "up" | "down", userId: string): Promise<"moved" | "at_the_end" | "not_found">;
    setStatus(ids: string[], status: "draft" | "published", userId: string): Promise<number>;
  };
  media: { store(bytes: Uint8Array, purpose: ContentMediaPurpose): Promise<ContentMedia> };
}

const REFUSAL_STATUS: Record<ContentMediaError["code"], number> = {
  unsupported_media_type: 415,
  file_too_large: 413,
  empty_file: 400,
};

const UNKNOWN_FAMILY = { error: { code: "unknown_family", message: "No active model carries that family." } };
const NOT_FOUND = { error: { code: "not_found", message: "That item does not exist or was deleted." } };

/**
 * Effects, courses and the prompt bank, edited from the panel.
 *
 * `content.read` lists; `content.write` creates, edits, deletes and uploads.
 * Every write is audited. `audit_log.target_id` is a uuid column, so the
 * target is the row's uuid and the code the site uses (`p1`, `fx-…`) goes in
 * `after` beside it — that is what matches an entry to the card somebody
 * complained about. An upload has no row yet, so it has no target at all.
 */
export function registerAdminContentRoutes(app: FastifyInstance, dependencies: AdminContentDependencies, guard: AdminGuard): void {
  const { content, media } = dependencies;

  app.get("/api/v1/admin/content", async (request, reply) => {
    const session = await guard.require(request, reply, "content.read");
    if (!session) return;
    const { kind } = z.object({ kind: EditableContentKindSchema }).parse(request.query);
    return reply.send({ entries: await content.list(kind) });
  });

  app.post("/api/v1/admin/content", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const session = await guard.require(request, reply, "content.write");
    if (!session) return;
    const write = ContentWriteSchema.parse(request.body);
    const entry = await content.create(write, session.userId);
    if (entry === "unknown_family") return reply.code(422).send(UNKNOWN_FAMILY);
    await guard.audit(request, session, {
      action: "content.create",
      targetType: write.kind,
      targetId: entry.id,
      after: { code: entry.item.id, status: entry.status, title: titleOf(entry) },
    });
    return reply.code(201).send({ entry });
  });

  app.put("/api/v1/admin/content/:id", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const session = await guard.require(request, reply, "content.write");
    if (!session) return;
    const id = z.uuid().safeParse((request.params as { id: string }).id);
    if (!id.success) return reply.code(404).send(NOT_FOUND);
    const write = ContentWriteSchema.parse(request.body);
    const entry = await content.update(id.data, write, session.userId);
    if (entry === "not_found") return reply.code(404).send(NOT_FOUND);
    if (entry === "unknown_family") return reply.code(422).send(UNKNOWN_FAMILY);
    await guard.audit(request, session, {
      action: "content.update",
      targetType: write.kind,
      targetId: entry.id,
      after: { code: entry.item.id, status: entry.status, title: titleOf(entry) },
    });
    return reply.send({ entry });
  });

  app.delete("/api/v1/admin/content/:id", async (request, reply) => {
    const session = await guard.require(request, reply, "content.write");
    if (!session) return;
    const id = z.uuid().safeParse((request.params as { id: string }).id);
    if (!id.success) return reply.code(404).send(NOT_FOUND);
    const archived = await content.archive(id.data, session.userId);
    if (!archived) return reply.code(404).send(NOT_FOUND);
    // A shelf that still holds items. Said with the count, because the next
    // question is always "how many, and where are they?".
    if ("inUse" in archived) {
      return reply.code(409).send({
        error: {
          code: "category_in_use",
          message: `That category still holds ${archived.inUse} item(s). Move them first.`,
          details: { inUse: archived.inUse },
        },
      });
    }
    await guard.audit(request, session, {
      action: "content.delete",
      targetType: archived.kind,
      targetId: id.data,
      after: { code: archived.code, status: "archived" },
    });
    return reply.send({ id: id.data, status: "archived" });
  });

  /**
   * One place up or down the order the site draws.
   *
   * New rows land first and there was no way to change that afterwards, so the
   * effects wall was in the order somebody happened to add things.
   */
  app.post("/api/v1/admin/content/:id/move", { bodyLimit: 1024 }, async (request, reply) => {
    const session = await guard.require(request, reply, "content.write");
    if (!session) return;
    const id = z.uuid().safeParse((request.params as { id: string }).id);
    if (!id.success) return reply.code(404).send(NOT_FOUND);
    const { direction } = z
      .object({ direction: z.enum(["up", "down"]) })
      .strict()
      .parse(request.body);

    const outcome = await content.move(id.data, direction, session.userId);
    if (outcome === "not_found") return reply.code(404).send(NOT_FOUND);
    // Already at the end is not an error: the button is simply a no-op there,
    // and answering 4xx would make the panel show a failure for a press that
    // did exactly what it should.
    if (outcome === "moved") {
      await guard.audit(request, session, { action: "content.moved", targetType: "content_item", targetId: id.data, after: { direction } });
    }
    return reply.send({ id: id.data, outcome });
  });

  /** Publish or unpublish several at once — the one-by-one version of this is a lot of clicks. */
  app.post("/api/v1/admin/content/bulk", { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const session = await guard.require(request, reply, "content.write");
    if (!session) return;
    const body = z
      .object({ ids: z.array(z.uuid()).min(1).max(200), status: z.enum(["draft", "published"]) })
      .strict()
      .parse(request.body);

    const changed = await content.setStatus(body.ids, body.status, session.userId);
    if (changed > 0) {
      await guard.audit(request, session, {
        action: body.status === "published" ? "content.published" : "content.unpublished",
        targetType: "content_item",
        after: { count: changed, ids: body.ids.slice(0, 20) },
      });
    }
    return reply.send({ changed });
  });

  /**
   * One cover or lesson file. `?purpose=cover|lesson` sets the ceiling before
   * the bytes arrive; the real type and its own limit are checked once they
   * have. See `CONTENT_MEDIA_LIMITS`.
   */
  app.post("/api/v1/admin/content/media", async (request, reply) => {
    const session = await guard.require(request, reply, "content.write");
    if (!session) return;
    const { purpose } = z.object({ purpose: ContentMediaPurposeSchema }).parse(request.query);
    if (!request.isMultipart()) {
      return reply.code(415).send({ error: { code: "expected_multipart", message: "Send the file as multipart/form-data." } });
    }

    const ceiling = contentMediaCeiling(purpose);
    const file = await request.file({ limits: { fileSize: ceiling, files: 1 } });
    if (!file) return reply.code(400).send({ error: { code: "no_file", message: "No file was attached." } });
    const bytes = await file.toBuffer();
    // Truncated at the ceiling rather than refused, by @fastify/multipart —
    // stored as it stands that would be a corrupt video.
    if (file.file.truncated) {
      return reply
        .code(413)
        .send({ error: { code: "file_too_large", message: `That file is over the ${ceiling / (1024 * 1024)}MB limit.` } });
    }

    try {
      const stored = await media.store(new Uint8Array(bytes), purpose);
      await guard.audit(request, session, {
        action: "content.media.upload",
        targetType: "content_media",
        after: { url: stored.url, purpose, kind: stored.kind, byteSize: stored.byteSize },
      });
      return reply.code(201).send(stored);
    } catch (error) {
      if (error instanceof ContentMediaError) {
        return reply.code(REFUSAL_STATUS[error.code]).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
}

function titleOf(entry: ContentEntry): string {
  return entry.kind === "prompt_fragment" || entry.kind === "category" ? entry.item.label : entry.item.title;
}
