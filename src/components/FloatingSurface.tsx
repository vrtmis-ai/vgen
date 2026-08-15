import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface FloatingPosition {
  top: number;
  left: number;
}

function place(anchor: HTMLElement, surface: HTMLElement): FloatingPosition {
  const anchorRect = anchor.getBoundingClientRect();
  const surfaceRect = surface.getBoundingClientRect();
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const offsetLeft = window.visualViewport?.offsetLeft ?? 0;
  const offsetTop = window.visualViewport?.offsetTop ?? 0;
  const gap = 8;

  let top = anchorRect.top - surfaceRect.height - gap;
  if (top < offsetTop + gap) top = Math.min(anchorRect.bottom + gap, offsetTop + viewportHeight - surfaceRect.height - gap);

  const rtl = document.documentElement.dir === "rtl";
  let left = rtl ? anchorRect.right - surfaceRect.width : anchorRect.left;
  left = Math.max(offsetLeft + gap, Math.min(left, offsetLeft + viewportWidth - surfaceRect.width - gap));
  return { top, left };
}

export function useFloatingPosition(
  anchor: HTMLElement | null,
  surfaceRef: RefObject<HTMLElement | null>,
  dependencyKey = "",
): FloatingPosition | null {
  const [position, setPosition] = useState<FloatingPosition | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !surfaceRef.current) return;
    const update = () => {
      if (surfaceRef.current) setPosition(place(anchor, surfaceRef.current));
    };
    update();

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(surfaceRef.current);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [anchor, dependencyKey, surfaceRef]);

  return position;
}

export function useFloatingDismiss({
  anchor,
  surfaceRef,
  onClose,
}: {
  anchor: HTMLElement | null;
  surfaceRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (surfaceRef.current?.contains(target) || anchor?.contains(target)) return;
      closeRef.current();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", keydown);
      if (anchor?.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor, surfaceRef]);
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function useModalSurface({
  surfaceRef,
  onClose,
  initialFocusRef,
}: {
  surfaceRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
}): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalRoot = surface.closest<HTMLElement>("[data-modal-root]") ?? surface;
    const siblings = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== modalRoot,
    );
    const inertState = siblings.map((element) => ({ element, inert: Boolean(element.inert) }));
    siblings.forEach((element) => {
      element.inert = true;
    });

    const focusables = () => Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hidden);
    (initialFocusRef?.current ?? focusables()[0] ?? surface).focus({ preventScroll: true });

    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        surface.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      inertState.forEach(({ element, inert }) => {
        element.inert = inert;
      });
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [initialFocusRef, surfaceRef]);
}
