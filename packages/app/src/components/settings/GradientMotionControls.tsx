import { Switch } from "@/components/ui/switch";
import { GRADIENT_CYCLE_LIMITS, GRADIENT_MOTION_MODES } from "@readany/core/reader/focus-reading";
import type { FocusReadingSettings } from "@readany/core/types/book";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export function GradientMotionControls({
  config,
  onChange,
}: { config: FocusReadingSettings; onChange: (value: Partial<FocusReadingSettings>) => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="space-y-3 border-t border-border/50 pt-3">
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={id} className="text-sm">
          {t("settings.focusMotion")}
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {t("settings.focusMotionDesc")}
          </span>
        </label>
        <Switch
          id={id}
          checked={config.gradientMotionEnabled}
          onCheckedChange={(value) =>
            onChange({ gradientMotionEnabled: value, ...(value ? { gradientEnabled: true } : {}) })
          }
        />
      </div>
      {config.gradientMotionEnabled && (
        <>
          <fieldset className="grid grid-cols-2 gap-2" aria-label={t("settings.focusMotionMode")}>
            {GRADIENT_MOTION_MODES.map((mode, index) => (
              <button
                type="button"
                key={mode}
                aria-pressed={config.gradientMotionMode === mode}
                onClick={() => onChange({ gradientMotionMode: mode })}
                className={`rounded-md border border-border bg-background px-3 py-2 text-left aria-pressed:border-primary ${index === 4 ? "col-span-2" : ""}`}
              >
                <span className="block text-xs font-medium">
                  {t(`settings.focusMotion_${mode}`)}
                </span>
                <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                  {t(`settings.focusMotion_${mode}Desc`)}
                </span>
              </button>
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium">{t("settings.focusMotionRange")}</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-[11px] text-muted-foreground" htmlFor={`${id}-min`}>
                {t("settings.focusMotionFast")}
                <input
                  id={`${id}-min`}
                  type="number"
                  min={GRADIENT_CYCLE_LIMITS.min}
                  max={config.gradientCycleMax - GRADIENT_CYCLE_LIMITS.gap}
                  step={1}
                  value={config.gradientCycleMin}
                  onChange={(event) => {
                    if (event.target.value)
                      onChange({
                        gradientCycleMin: Math.max(
                          GRADIENT_CYCLE_LIMITS.min,
                          Math.min(
                            config.gradientCycleMax - GRADIENT_CYCLE_LIMITS.gap,
                            Number(event.target.value),
                          ),
                        ),
                      });
                  }}
                  className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground"
                />
              </label>
              <label className="space-y-1 text-[11px] text-muted-foreground" htmlFor={`${id}-max`}>
                {t("settings.focusMotionSlow")}
                <input
                  id={`${id}-max`}
                  type="number"
                  min={config.gradientCycleMin + GRADIENT_CYCLE_LIMITS.gap}
                  max={GRADIENT_CYCLE_LIMITS.max}
                  step={1}
                  value={config.gradientCycleMax}
                  onChange={(event) => {
                    if (event.target.value)
                      onChange({
                        gradientCycleMax: Math.min(
                          GRADIENT_CYCLE_LIMITS.max,
                          Math.max(
                            config.gradientCycleMin + GRADIENT_CYCLE_LIMITS.gap,
                            Number(event.target.value),
                          ),
                        ),
                      });
                  }}
                  className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground"
                />
              </label>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("settings.focusMotionRangeHint")}
            </p>
          </fieldset>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("settings.focusMotionCaution")}
          </p>
        </>
      )}
    </div>
  );
}
