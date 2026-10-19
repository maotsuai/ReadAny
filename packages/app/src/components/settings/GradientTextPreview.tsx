import { GradientAnimation } from "@readany/core/reader/gradient-motion-dom";
import type { FocusReadingSettings } from "@readany/core/types/book";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function GradientTextPreview({
  config,
  foreground,
  background,
  text,
}: { config: FocusReadingSettings; foreground: string; background: string; text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const animation = useRef<GradientAnimation | null>(null);
  const [reduced, setReduced] = useState(false);
  const { t } = useTranslation();
  useEffect(() => {
    if (!ref.current) return;
    const instance = new GradientAnimation(ref.current);
    animation.current = instance;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => {
      instance.destroy();
      animation.current = null;
      media.removeEventListener("change", sync);
    };
  }, []);
  const payload = JSON.stringify(config);
  useEffect(() => {
    animation.current?.update(JSON.parse(payload), foreground, background);
  }, [payload, foreground, background]);
  return (
    <>
      <p
        ref={ref}
        className="mt-2 font-serif text-[17px] leading-[1.9]"
        style={
          config.gradientEnabled
            ? {
                backgroundImage: "var(--readany-focus-image)",
                backgroundPosition: "var(--readany-focus-motion-shift, 0em) 0",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                color: "transparent",
              }
            : undefined
        }
      >
        {text}
      </p>
      {reduced && config.gradientMotionEnabled && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {t("settings.focusMotionReduced")}
        </p>
      )}
    </>
  );
}
