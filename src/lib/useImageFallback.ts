import { useState } from "react";

/**
 * Hide an <img> whose source fails to load.
 *
 * The obvious `onError={(e) => e.currentTarget.remove()}` detaches a node React
 * still believes it owns, so the next unmount throws
 * "NotFoundError: The node to be removed is not a child of this node" and takes
 * the screen down with it. Covers come from a third-party CDN and do fail, so
 * this was a real crash, not a theoretical one. Stop rendering the element
 * instead of ripping it out.
 */
export function useImageFallback(): readonly [boolean, () => void] {
  const [failed, setFailed] = useState(false);
  return [failed, () => setFailed(true)] as const;
}
