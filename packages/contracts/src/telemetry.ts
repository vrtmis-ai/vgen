import { z } from "zod";

export const FrontendCrashReportSchema = z
  .object({
    type: z.literal("frontend_crash"),
    release: z.string().trim().min(1).max(80),
    host: z.literal("web"),
    route: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .startsWith("/")
      .refine((route) => !route.includes("?") && !route.includes("#"), "Route must not include query or fragment data"),
    code: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9_.:-]+$/),
    requestId: z.string().trim().min(1).max(128).optional(),
    occurredAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  })
  .strict();

export const FrontendCrashAcceptedSchema = z.object({
  accepted: z.literal(true),
  reportId: z.string().min(1),
});

export type FrontendCrashReport = z.infer<typeof FrontendCrashReportSchema>;
export type FrontendCrashAccepted = z.infer<typeof FrontendCrashAcceptedSchema>;
