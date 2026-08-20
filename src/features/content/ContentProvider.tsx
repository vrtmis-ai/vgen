import { createContext, useContext, type ReactNode } from "react";
import type { ContentSnapshot } from "../../runtime/contracts/content";

const ContentContext = createContext<ContentSnapshot | null>(null);

/**
 * The served editorial content, handed down the tree.
 *
 * A context for the same reason the catalogue is one: presets are needed by
 * Effects, courses and fragments by Academy, the featured shelf and examples by
 * Explore, skills by Mcp and voices by the audio studio. Threading seven
 * collections through the layouts to reach them would put a content parameter
 * on every component between here and there.
 */
export function ContentProvider({ content, children }: { content: ContentSnapshot; children: ReactNode }) {
  return <ContentContext.Provider value={content}>{children}</ContentContext.Provider>;
}

/**
 * Throws rather than falling back to the committed snapshot.
 *
 * A fallback would be the bug this port exists to remove: a screen showing an
 * effect an admin pulled an hour ago, and doing it silently. Everything that
 * calls this sits under a gate that has already waited for `GET /content`.
 */
export function usePublishedContent(): ContentSnapshot {
  const content = useContext(ContentContext);
  if (!content) throw new Error("Published content is not available. Wrap the screen in ContentProvider.");
  return content;
}
