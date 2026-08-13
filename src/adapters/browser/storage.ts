import { z } from "zod";

export const STORAGE_VERSION = 1 as const;

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StoragePort | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function storageFor(storage?: StoragePort): StoragePort | undefined {
  return storage ?? browserStorage();
}

function safeWrite(key: string, value: unknown, storage?: StoragePort): void {
  try {
    storageFor(storage)?.setItem(key, JSON.stringify(value));
  } catch {
    // Persistence is a convenience; blocked storage must not break the app.
  }
}

function isVersionedValue(value: unknown): value is { version: typeof STORAGE_VERSION; value: unknown } {
  return typeof value === "object" && value !== null && "version" in value && "value" in value && value.version === STORAGE_VERSION;
}

export function writeStoredCollection<T>(key: string, items: readonly T[], storage?: StoragePort): void {
  safeWrite(key, { version: STORAGE_VERSION, items }, storage);
}

export function writeStoredValue<T>(key: string, value: T, storage?: StoragePort): void {
  safeWrite(key, { version: STORAGE_VERSION, value }, storage);
}

export function readStoredCollection<T>(key: string, itemSchema: z.ZodType<T>, storage?: StoragePort): T[] {
  const target = storageFor(storage);
  if (!target) return [];

  try {
    const raw = target.getItem(key);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    const isLegacy = Array.isArray(parsed);
    const candidates = isLegacy
      ? parsed
      : typeof parsed === "object" &&
          parsed !== null &&
          "version" in parsed &&
          "items" in parsed &&
          parsed.version === STORAGE_VERSION &&
          Array.isArray(parsed.items)
        ? parsed.items
        : undefined;

    if (!candidates) return [];

    const items = candidates.flatMap((candidate) => {
      const result = itemSchema.safeParse(candidate);
      return result.success ? [result.data] : [];
    });

    if (isLegacy || items.length !== candidates.length) writeStoredCollection(key, items, target);
    return items;
  } catch {
    return [];
  }
}

export function readStoredValue<T>(key: string, schema: z.ZodType<T>, fallback: T, storage?: StoragePort): T {
  const target = storageFor(storage);
  if (!target) return fallback;

  try {
    const raw = target.getItem(key);
    if (raw === null) return fallback;

    let parsed: unknown;
    let jsonParsed = true;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
      jsonParsed = false;
    }

    let isVersioned = false;
    let candidate = parsed;
    if (isVersionedValue(parsed)) {
      isVersioned = true;
      candidate = parsed.value;
    }
    const result = schema.safeParse(candidate);
    if (!result.success) return fallback;

    if (!isVersioned || !jsonParsed) writeStoredValue(key, result.data, target);
    return result.data;
  } catch {
    return fallback;
  }
}
