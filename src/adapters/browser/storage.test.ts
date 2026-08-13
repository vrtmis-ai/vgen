import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loadGenerations } from "../../lib/gallery";
import { readStoredCollection, readStoredValue, writeStoredCollection, writeStoredValue, type StoragePort } from "./storage";

const itemSchema = z.object({ id: z.string().min(1), status: z.enum(["running", "done"]) });

describe("versioned browser storage", () => {
  beforeEach(() => localStorage.clear());

  it("falls back when JSON is corrupted", () => {
    localStorage.setItem("broken", "{not-json");

    expect(readStoredCollection("broken", itemSchema)).toEqual([]);
  });

  it("migrates an unversioned collection and drops only invalid records", () => {
    localStorage.setItem(
      "jobs",
      JSON.stringify([
        { id: "still-running", status: "running" },
        { id: "bad-status", status: "complete" },
        { status: "done" },
        { id: "finished", status: "done" },
      ]),
    );

    expect(readStoredCollection("jobs", itemSchema)).toEqual([
      { id: "still-running", status: "running" },
      { id: "finished", status: "done" },
    ]);
    expect(JSON.parse(localStorage.getItem("jobs") ?? "null")).toEqual({
      version: 1,
      items: [
        { id: "still-running", status: "running" },
        { id: "finished", status: "done" },
      ],
    });
  });

  it("reads a versioned value and rejects missing fields or invalid enums", () => {
    const preferenceSchema = z.object({ mode: z.enum(["grid", "list"]), density: z.number().int().min(0).max(4) });

    localStorage.setItem("view", JSON.stringify({ version: 1, value: { mode: "tiles", density: 2 } }));
    expect(readStoredValue("view", preferenceSchema, { mode: "grid", density: 2 })).toEqual({ mode: "grid", density: 2 });

    localStorage.setItem("view", JSON.stringify({ version: 1, value: { mode: "list" } }));
    expect(readStoredValue("view", preferenceSchema, { mode: "grid", density: 2 })).toEqual({ mode: "grid", density: 2 });
  });

  it("migrates a raw string value", () => {
    localStorage.setItem("language", "en");

    expect(readStoredValue("language", z.enum(["fa", "en"]), "fa")).toBe("en");
    expect(JSON.parse(localStorage.getItem("language") ?? "null")).toEqual({ version: 1, value: "en" });
  });

  it("does not throw when storage writes fail", () => {
    const quotaStorage: StoragePort = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }),
    };

    expect(() => writeStoredCollection("jobs", [{ id: "a", status: "done" }], quotaStorage)).not.toThrow();
    expect(() => writeStoredValue("language", "fa", quotaStorage)).not.toThrow();
  });

  it("keeps a persisted generation running and ignores malformed siblings", () => {
    localStorage.setItem(
      "vgen:gens",
      JSON.stringify([
        {
          id: "client-1",
          jobId: "job-1",
          familyId: "seedance",
          variantId: "seedance-1",
          name: "Seedance",
          vendor: "ByteDance",
          grad: "linear-gradient(#111, #222)",
          kind: "video",
          prompt: "A quiet forest",
          w: 1280,
          h: 720,
          status: "running",
          progress: 37,
          createdAt: 1,
        },
        { id: "incomplete", status: "done" },
      ]),
    );

    expect(loadGenerations()).toMatchObject([{ id: "client-1", status: "running", progress: 37 }]);
  });
});
