import { ManualFocusStrip } from "@readany/core/reader/focus-strip-dom";
import { useEffect, useRef } from "react";

export function FocusStripPreview({
  text,
  color,
  highlight,
}: { text: string; color: string; highlight: string }) {
  const host = useRef<HTMLDivElement>(null);
  const strip = useRef<ManualFocusStrip | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const controller = new ManualFocusStrip(host.current);
    strip.current = controller;
    return () => {
      controller.destroy();
      strip.current = null;
    };
  }, []);
  useEffect(
    () => strip.current?.update(text, color, highlight, "serif", 24),
    [text, color, highlight],
  );
  return (
    <div className="relative h-24 border-y border-border/60">
      <div ref={host} className="h-full" />
      {["top-0", "bottom-0"].map((edge) => (
        <i
          key={edge}
          className={`pointer-events-none absolute left-[40%] h-3 w-px bg-current ${edge}`}
        />
      ))}
    </div>
  );
}
