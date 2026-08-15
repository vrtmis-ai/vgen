export interface DatabaseHealthPort {
  ping(): Promise<void>;
}

export * from "./accessRepository";
export * from "./authRepository";
export * from "./walletRepository";
export * from "./catalogRepository";
export * from "./frontendTelemetryRepository";
export * from "./generationRepository";
export * from "./outbox";

/* The Drizzle schema mirror is gone. It described the 30-table schema this
   package no longer targets, nothing ever queried through it — every statement
   here is raw tagged-template SQL — and its test asserted only table names, so
   column drift passed silently. Re-mirroring 91 tables by hand would be a second
   source of truth with the same weakness. The migrations are the schema. */
