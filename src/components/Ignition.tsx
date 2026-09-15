import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ignite, reducedMotion } from "./dotSignature";

function Ignition({ origin, onDone }: { origin: { x: number; y: number }; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return ignite(canvas, origin, () => done.current());
    // A run starts once per mount; a new press mounts a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" />;
}

/**
 * The sign-in field on the button that starts a generation.
 *
 * `ignite(event, submit)` lights the field from the pressed point and calls
 * `submit` when it has swept the button. The submission waits for it on
 * purpose: the field is the answer to the press, and the job arriving on the
 * canvas is the answer after that. Sent at the press, the card could land
 * before the field had drawn, and the two would read as unrelated. (While a
 * submit still left for کارهای من, it also carried the button off screen
 * mid-sweep — which is why the first version of this was never seen.)
 * The wait is `IGNITION_MS` on a timer (so a switch to another tab cannot
 * stall it), and nothing is sent twice: a second press while it runs is
 * ignored.
 *
 * Reduced motion skips the field and submits at once.
 *
 * The button needs `relative overflow-hidden`, and its label a positioned
 * wrapper so it paints above the canvas. Not `disabled` while igniting — that
 * would fade the whole button, field included, to a third of its opacity.
 * A keyboard press arrives as a click with `detail === 0`, so it lights from
 * the centre rather than a corner.
 */
export function useIgnition(): {
  ignite: (event: MouseEvent<HTMLElement>, submit: () => void) => void;
  igniting: boolean;
  layer: ReactNode;
} {
  const [spark, setSpark] = useState<{ id: number; x: number; y: number; submit: () => void } | null>(null);
  const counter = useRef(0);

  const start = (event: MouseEvent<HTMLElement>, submit: () => void) => {
    if (spark) return;
    if (reducedMotion()) return submit();
    const box = event.currentTarget.getBoundingClientRect();
    const fromPointer = event.detail > 0 && box.width > 0 && box.height > 0;
    counter.current += 1;
    setSpark({
      id: counter.current,
      x: fromPointer ? (event.clientX - box.left) / box.width : 0.5,
      y: fromPointer ? (event.clientY - box.top) / box.height : 0.5,
      submit,
    });
  };

  const layer = spark ? (
    <Ignition
      key={spark.id}
      origin={{ x: spark.x, y: spark.y }}
      onDone={() => {
        setSpark(null);
        spark.submit();
      }}
    />
  ) : null;

  return { ignite: start, igniting: spark !== null, layer };
}
