import { z } from "zod";

export * from "./auth";
export * from "./session";
export * from "./catalog";
export * from "./telemetry";
export * from "./generation";
export * from "./assets";
export * from "./plans";

export const DependencyHealthSchema = z.object({
  database: z.enum(["up", "down"]),
  redis: z.enum(["up", "down"]),
  storage: z.enum(["up", "down"]),
});

export const ReadinessSchema = z.object({
  status: z.enum(["ready", "degraded"]),
  dependencies: DependencyHealthSchema,
});

export type Readiness = z.infer<typeof ReadinessSchema>;
