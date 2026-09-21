import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { ContentProvider } from "../features/content/ContentProvider";
import { createDemoCatalogService } from "../adapters/demo/catalog";
import { createDemoContentService } from "../adapters/demo/content";
import type { ContentSnapshot } from "../runtime/contracts/content";
import Academy from "./Academy";

const content = await createDemoContentService(() => 0).list();
const catalog = await createDemoCatalogService(() => 0).list();

function renderAcademy(served: ContentSnapshot = content) {
  return render(
    <LanguageProvider initialLang="fa">
      <CatalogProvider families={catalog.families}>
        <ContentProvider content={served}>
          <Academy onOpenModel={vi.fn()} />
        </ContentProvider>
      </CatalogProvider>
    </LanguageProvider>,
  );
}

describe("searching the prompt bank", () => {
  it("looks through every category, not just the open tab", async () => {
    renderAcademy();
    expect(screen.getByText("نمای ثابت")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox", { name: "جستجو در بانک پرامپت" }), "neon");

    // Filed under lighting while camera is the open tab, and found anyway.
    expect(screen.getByText("نئون شبانه")).toBeInTheDocument();
    expect(screen.queryByText("نمای ثابت")).not.toBeInTheDocument();
  });

  it("matches the Persian name, whichever keyboard typed it", async () => {
    renderAcademy();

    // Arabic kaf and yeh, which is what some keyboards send for ک and ی.
    await userEvent.type(screen.getByRole("searchbox", { name: "جستجو در بانک پرامپت" }), "كلوزآپ");

    expect(screen.getByText("کلوزآپ")).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    renderAcademy();

    await userEvent.type(screen.getByRole("searchbox", { name: "جستجو در بانک پرامپت" }), "zzzz");

    expect(screen.getByText("چیزی پیدا نشد.")).toBeInTheDocument();
  });
});

describe("a course with uploaded lessons", () => {
  it("plays the first lesson that has a video when the course is started", async () => {
    const [course, ...rest] = content.courses;
    const lessons = course!.lessons.map((lesson, index) =>
      index === 1 ? { ...lesson, videoUrl: "/api/v1/content/media/0192f7a0-0000-7000-8000-000000000003.mp4" } : lesson,
    );
    const { container } = renderAcademy({ ...content, courses: [{ ...course!, lessons }, ...rest] });

    await userEvent.click(screen.getByText(course!.title));
    await userEvent.click(screen.getByRole("button", { name: /شروع دوره/ }));

    const player = container.ownerDocument.querySelector("video[controls]");
    expect(player?.getAttribute("src")).toBe("/api/v1/content/media/0192f7a0-0000-7000-8000-000000000003.mp4");
    expect(player).toHaveAccessibleName(lessons[1]!.title);
    // The "not uploaded yet" line is only for a course with nothing to play.
    expect(screen.queryByText(/ویدیوها هنوز آپلود نشده‌اند/)).not.toBeInTheDocument();
  });
});
