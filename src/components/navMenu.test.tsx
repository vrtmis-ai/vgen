import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { useNavMenus } from "./navMenu";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { createDemoCatalogService } from "../adapters/demo/catalog";
import type { CatalogSnapshot } from "../runtime/contracts/catalog";

/**
 * Driven against the served catalogue, which is the whole point of the file
 * under test: the menu is derived, so a fixture listing the models here would
 * assert that this test and `navMenu.ts` agree with each other rather than that
 * either agrees with the shop.
 */
const catalog = await createDemoCatalogService(() => 0).list();

function withCatalog(families: CatalogSnapshot["families"]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <CatalogProvider families={families}>{children}</CatalogProvider>;
  };
}

function menus(families: CatalogSnapshot["families"] = catalog.families) {
  return renderHook(() => useNavMenus(), { wrapper: withCatalog(families) }).result.current;
}

describe("the nav menus", () => {
  it("opens under the three making items and nowhere else", () => {
    expect(Object.keys(menus()).sort()).toEqual(["audio", "image", "video"]);
  });

  it("names every column after a feature code the catalogue actually uses", () => {
    const codes = menus().video?.columns.map((column) => column.code);
    const served = new Set(
      catalog.families
        .filter((family) => family.kind === "video")
        .flatMap((family) => family.variants.map((variant) => variant.featureCode)),
    );

    expect(codes?.length).toBeGreaterThan(0);
    for (const code of codes ?? []) expect(served.has(code)).toBe(true);
  });

  it("lists a family under each capability it carries, not only its first", () => {
    // Wan generates, animates a still and edits, so it earns a row in all three
    // of ویدیو's columns. Deduplicating to one "primary" column would hide it
    // from exactly the visitor who came looking for that capability.
    const wan = catalog.families.find((family) => family.id === "wan");
    const carried = new Set(wan?.variants.map((variant) => variant.featureCode));
    expect(carried.size).toBeGreaterThan(1);

    const columnsWithWan = menus()
      .video?.columns.filter((column) => column.rows.some((row) => row.family.id === "wan"))
      .map((column) => column.code);

    expect(new Set(columnsWithWan)).toEqual(carried);
  });

  it("drops a column no family answers to, rather than titling an empty one", () => {
    // Only the families that purely generate, so عکس به ویدیو and ویرایش ویدیو
    // have nobody left in them.
    const generateOnly = catalog.families.filter(
      (family) => family.kind !== "video" || family.variants.every((variant) => variant.featureCode === "video_generate"),
    );

    const columns = menus(generateOnly).video?.columns;
    expect(columns?.map((column) => column.code)).toEqual(["video_generate"]);
    expect(columns?.every((column) => column.rows.length > 0)).toBe(true);
  });

  it("has no menu at all for a kind the catalogue no longer carries", () => {
    const withoutVideo = catalog.families.filter((family) => family.kind !== "video");
    expect(menus(withoutVideo).video).toBeUndefined();
  });

  it("points its footer at the studio the menu describes", () => {
    expect(menus().video?.footer.href).toBe("/studio/video");
    expect(menus().image?.footer.href).toBe("/studio/image");
    expect(menus().audio?.footer.href).toBe("/studio/audio");
  });
});
