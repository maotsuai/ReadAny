import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settings-store";
import {
  FOCUS_PALETTES,
  focusFragment,
  needsMotionConfirmation,
  normalizeFocusReading,
  splitFocusText,
} from "@readany/core/reader/focus-reading";
import { readableFocusColor } from "@readany/core/reader/focus-reading-dom";
import type { FocusReadingSettings as FocusConfig } from "@readany/core/types/book";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { FocusStripPreview } from "./FocusStripPreview";
import { GradientMotionControls } from "./GradientMotionControls";
import { GradientTextPreview } from "./GradientTextPreview";

function previewPaper() {
  const mode = document.documentElement.dataset.theme;
  return mode === "dark"
    ? { fg: "#f5f5f5", bg: "#121212" }
    : mode === "sepia"
      ? { fg: "#3d2b1f", bg: "#f0e6d2" }
      : { fg: "#1a1a1a", bg: "#ffffff" };
}

export function FocusReadingSettings() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.readSettings.focusReading);
  const updateReadSettings = useSettingsStore((s) => s.updateReadSettings);
  const config = normalizeFocusReading(settings);
  const [pendingMotion, setPendingMotion] = useState<FocusConfig | null>(null);
  const id = useId();
  const update = (updates: Partial<FocusConfig>) => {
    setPlaying(false);
    const next = normalizeFocusReading({ ...config, ...updates });
    if (needsMotionConfirmation(config, next)) setPendingMotion(next);
    else updateReadSettings({ focusReading: next });
  };
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [paper, setPaper] = useState(previewPaper);
  useEffect(() => {
    const observer = new MutationObserver(() => setPaper(previewPaper()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const pause = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", pause);
    };
  }, []);
  const flashText =
    config.flashTextColor === "auto"
      ? paper.fg
      : readableFocusColor(config.flashTextColor, paper.bg, paper.fg);
  const flashAnchor = readableFocusColor(config.flashHighlightColor, paper.bg, paper.fg);
  const fragments = splitFocusText(t("settings.focusSample")).filter((part) => part.trim());
  useEffect(() => {
    if (!playing || !config.flashEnabled || config.flashInterval <= 0) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % fragments.length),
      config.flashInterval * 1000,
    );
    return () => clearInterval(timer);
  }, [playing, config.flashInterval, config.flashEnabled, fragments.length]);
  const part = focusFragment(fragments[index % fragments.length] ?? "");
  const colorField = (
    key: "gradientColor1" | "gradientColor2" | "flashTextColor" | "flashHighlightColor",
    label: string,
  ) => (
    <label
      className="flex min-w-0 items-center justify-between gap-2 text-xs"
      htmlFor={`${id}-${key}`}
    >
      <span>{label}</span>
      <input
        id={`${id}-${key}`}
        type="color"
        value={config[key] === "auto" ? "#222222" : config[key]}
        onChange={(event) => update({ [key]: event.target.value })}
        className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
    </label>
  );
  return (
    <section className="space-y-4 rounded-lg bg-muted/60 p-4">
      <div>
        <h2 className="text-sm font-medium">{t("settings.focusTitle")}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("settings.focusDesc")}
        </p>
      </div>
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={`${id}-gradient`} className="text-sm">
          {t("settings.focusGradient")}
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {t("settings.focusGradientDesc")}
          </span>
        </label>
        <Switch
          id={`${id}-gradient`}
          checked={config.gradientEnabled}
          onCheckedChange={(checked) => update({ gradientEnabled: checked })}
        />
      </div>
      <GradientMotionControls config={config} onChange={update} />
      <div className="rounded-md border border-border/60 bg-background px-4 py-3">
        <span className="text-[10px] tracking-widest text-muted-foreground">
          {t("settings.focusPreview")}
        </span>
        <GradientTextPreview
          config={config}
          foreground={paper.fg}
          background={paper.bg}
          text={t("settings.focusSample")}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {FOCUS_PALETTES.map((palette) => (
          <button
            key={palette.id}
            type="button"
            aria-pressed={
              config.gradientColor1 === palette.colors[0] &&
              config.gradientColor2 === palette.colors[1]
            }
            onClick={() =>
              update({ gradientColor1: palette.colors[0], gradientColor2: palette.colors[1] })
            }
            className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-2 text-xs aria-pressed:border-primary"
          >
            <span className="flex -space-x-1" aria-hidden="true">
              {palette.colors.map((color) => (
                <span
                  key={color}
                  className="h-4 w-4 rounded-full border border-background"
                  style={{ background: color }}
                />
              ))}
            </span>
            {t(`settings.focus${palette.id[0].toUpperCase()}${palette.id.slice(1)}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {colorField("gradientColor1", t("settings.focusColor1"))}
        {colorField("gradientColor2", t("settings.focusColor2"))}
      </div>
      <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-4">
        <label htmlFor={`${id}-flash`} className="text-sm">
          {t("settings.focusFlash")}
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {t("settings.focusFlashDesc")}
          </span>
        </label>
        <Switch
          id={`${id}-flash`}
          checked={config.flashEnabled}
          onCheckedChange={(checked) => update({ flashEnabled: checked })}
        />
      </div>
      <div className="overflow-hidden rounded-md border border-border/60 bg-background py-3">
        {config.flashInterval === -1 ? (
          <>
            <FocusStripPreview
              text={t("settings.focusSample")}
              color={flashText}
              highlight={flashAnchor}
            />
            <p className="mt-3 px-3 text-center text-xs text-muted-foreground">
              {t("settings.focusSwipeHint")}
            </p>
          </>
        ) : (
          <>
            <div
              className="relative grid min-h-20 grid-cols-[1fr_auto_1.5fr] items-center whitespace-pre border-y border-border/60 px-2 font-serif text-xl"
              style={{ color: flashText }}
            >
              <span className="text-right">{part.before}</span>
              <span className="relative" style={{ color: flashAnchor }}>
                <i className="absolute -top-4 left-1/2 h-2 w-px bg-current" />
                {part.anchor}
                <i className="absolute -bottom-4 left-1/2 h-2 w-px bg-current" />
              </span>
              <span>{part.after}</span>
            </div>
            <div className="mt-3 flex justify-center gap-3 text-xs">
              <button
                type="button"
                className="rounded-full border border-border px-3 py-1 disabled:opacity-40"
                disabled={!config.flashEnabled || config.flashInterval === 0}
                onClick={() => setPlaying((v) => !v)}
              >
                {t(playing ? "settings.focusPause" : "settings.focusPlay")}
              </button>
              <button
                type="button"
                aria-label={t("settings.focusNext")}
                className="rounded-full border border-border px-3 py-1"
                onClick={() => {
                  setPlaying(false);
                  setIndex((i) => (i + 1) % fragments.length);
                }}
              >
                →
              </button>
            </div>
          </>
        )}
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between text-xs">
          <label htmlFor={`${id}-interval`}>{t("settings.focusInterval")}</label>
          <span className="tabular-nums">
            {config.flashInterval === -1
              ? t("settings.focusSwipe")
              : config.flashInterval === 0
                ? t("settings.focusManual")
                : `${config.flashInterval.toFixed(1)} s`}
          </span>
        </div>
        <Slider
          id={`${id}-interval`}
          aria-label={t("settings.focusInterval")}
          min={-1}
          max={20}
          step={1}
          value={[config.flashInterval === -1 ? -1 : Math.round(config.flashInterval * 10)]}
          onValueChange={([value]) => update({ flashInterval: value === -1 ? -1 : value / 10 })}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {t("settings.focusIntervalHint")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {colorField("flashTextColor", t("settings.focusTextColor"))}
        {colorField("flashHighlightColor", t("settings.focusAnchorColor"))}
      </div>
      <button
        type="button"
        className="text-xs text-muted-foreground underline underline-offset-4"
        onClick={() => update({ flashTextColor: "auto" })}
      >
        {t("settings.focusTextColor")} · {t("settings.focusAuto")}
      </button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("settings.focusScope")}
      </p>
      <Dialog
        open={pendingMotion !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMotion(null);
        }}
      >
        <DialogContent
          className="max-w-md"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(`${id}-motion-cancel`)?.focus();
          }}
        >
          <DialogTitle>{t("settings.focusMotionWarningTitle")}</DialogTitle>
          <DialogDescription className="whitespace-pre-line leading-relaxed">
            {t("settings.focusMotionWarning")}
          </DialogDescription>
          <DialogFooter className="gap-2">
            <Button
              id={`${id}-motion-cancel`}
              variant="outline"
              onClick={() => setPendingMotion(null)}
            >
              {t("settings.focusMotionCancel")}
            </Button>
            <Button
              onClick={() => {
                if (pendingMotion) updateReadSettings({ focusReading: pendingMotion });
                setPendingMotion(null);
              }}
            >
              {t("settings.focusMotionConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
