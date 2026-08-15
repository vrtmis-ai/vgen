import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

function isPayloadTooLarge(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { statusCode?: unknown; code?: unknown };
  return candidate.statusCode === 413 || candidate.code === "FST_ERR_CTP_BODY_TOO_LARGE";
}

function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 ? statusCode : null;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply) => {
    void reply.header("X-Request-Id", request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    if (isPayloadTooLarge(error)) {
      return reply.code(413).send({
        error: {
          code: "payload_too_large",
          message: "Request payload is too large",
          request_id: request.id,
        },
      });
    }

    if (error instanceof ZodError) {
      const fields = Object.fromEntries(error.issues.map((issue) => [issue.path.join(".") || "request", issue.message]));
      return reply.code(400).send({
        error: {
          code: "validation_failed",
          message: "Request validation failed",
          request_id: request.id,
          details: { fields },
        },
      });
    }

    const statusCode = clientErrorStatus(error);
    if (statusCode !== null) {
      return reply.code(statusCode).send({
        error: {
          code: "invalid_request",
          message: "Request could not be processed",
          request_id: request.id,
        },
      });
    }

    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({
      error: {
        code: "internal_error",
        message: "An unexpected error occurred",
        request_id: request.id,
      },
    });
  });
}
