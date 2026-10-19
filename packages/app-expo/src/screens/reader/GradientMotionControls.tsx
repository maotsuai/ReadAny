import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useColors } from "@/styles/theme";
import { GRADIENT_MOTION_MODES } from "@readany/core/reader/focus-reading";
import type { FocusReadingSettings } from "@readany/core/types/book";
import { useTranslation } from "react-i18next";
import { Pressable, Switch, Text, View } from "react-native";

export function GradientMotionControls({
  config,
  onChange,
}: { config: FocusReadingSettings; onChange: (value: Partial<FocusReadingSettings>) => void }) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const { t } = useTranslation();
  const hint = { color: colors.mutedForeground, fontSize: 11, lineHeight: 17 };
  const label = { color: colors.foreground, fontSize: 13 };
  const step = (key: "gradientCycleMin" | "gradientCycleMax", title: string) => {
    const lower = key === "gradientCycleMin" ? 8 : config.gradientCycleMin + 4;
    const upper = key === "gradientCycleMin" ? config.gradientCycleMax - 4 : 120;
    return (
      <View style={{ flex: 1, gap: 7 }}>
        <Text style={hint}>{title}</Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title} − 1 s`}
            disabled={config[key] <= lower}
            onPress={() => onChange({ [key]: Math.max(lower, config[key] - 1) })}
            style={{ padding: 10, opacity: config[key] <= lower ? 0.35 : 1 }}
          >
            <Text style={label}>−</Text>
          </Pressable>
          <Text style={{ ...label, fontVariant: ["tabular-nums"] }}>{config[key]} s</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title} + 1 s`}
            disabled={config[key] >= upper}
            onPress={() => onChange({ [key]: Math.min(upper, config[key] + 1) })}
            style={{ padding: 10, opacity: config[key] >= upper ? 0.35 : 1 }}
          >
            <Text style={label}>+</Text>
          </Pressable>
        </View>
      </View>
    );
  };
  return (
    <View style={{ gap: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={label}>{t("settings.focusMotion")}</Text>
          <Text style={hint}>{t("settings.focusMotionDesc")}</Text>
        </View>
        <Switch
          accessibilityLabel={t("settings.focusMotion")}
          value={config.gradientMotionEnabled}
          onValueChange={(value) =>
            onChange({ gradientMotionEnabled: value, ...(value ? { gradientEnabled: true } : {}) })
          }
          trackColor={{ true: colors.primary }}
        />
      </View>
      {config.gradientMotionEnabled && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {GRADIENT_MOTION_MODES.map((mode, index) => (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityState={{ selected: config.gradientMotionMode === mode }}
                onPress={() => onChange({ gradientMotionMode: mode })}
                style={{
                  width: index === 4 ? "100%" : "48%",
                  borderWidth: 1,
                  borderColor: config.gradientMotionMode === mode ? colors.primary : colors.border,
                  borderRadius: 8,
                  padding: 10,
                  gap: 4,
                }}
              >
                <Text style={label}>{t(`settings.focusMotion_${mode}`)}</Text>
                <Text style={hint}>{t(`settings.focusMotion_${mode}Desc`)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={label}>{t("settings.focusMotionRange")}</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {step("gradientCycleMin", t("settings.focusMotionFast"))}
            {step("gradientCycleMax", t("settings.focusMotionSlow"))}
          </View>
          <Text style={hint}>{t("settings.focusMotionRangeHint")}</Text>
          <Text style={hint}>
            {reduced ? t("settings.focusMotionReduced") : t("settings.focusMotionCaution")}
          </Text>
        </>
      )}
    </View>
  );
}
