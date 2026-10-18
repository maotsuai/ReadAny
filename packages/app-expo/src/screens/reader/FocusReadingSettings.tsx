import { useColors } from "@/styles/theme";
import { useIsFocused } from "@react-navigation/native";
import {
  FOCUS_PALETTES,
  focusFragment,
  focusGradient,
  normalizeFocusReading,
  splitFocusText,
} from "@readany/core/reader/focus-reading";
import { readableFocusColor } from "@readany/core/reader/focus-reading-dom";
import type { FocusReadingSettings as FocusConfig } from "@readany/core/types/book";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Pressable, Switch, Text, TextInput, View } from "react-native";
import { WebView } from "react-native-webview";

function ColorField({
  label,
  value,
  onChange,
}: { label: string; value: string; onChange: (value: string) => void }) {
  const colors = useColors();
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const valid = /^#[\da-f]{6}$/i.test(draft);
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          paddingHorizontal: 8,
        }}
      >
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: valid ? draft : colors.foreground,
          }}
        />
        <TextInput
          accessibilityLabel={label}
          value={draft === "auto" ? "" : draft}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={7}
          placeholder={value === "auto" ? t("settings.focusAuto") : "#RRGGBB"}
          placeholderTextColor={colors.mutedForeground}
          style={{
            flex: 1,
            minWidth: 60,
            color: colors.foreground,
            fontSize: 13,
            paddingVertical: 10,
          }}
          onChangeText={(value) => {
            setDraft(value);
            if (/^#[\da-f]{6}$/i.test(value)) onChange(value);
          }}
          onBlur={() => {
            if (!valid) setDraft(value);
          }}
        />
      </View>
      {!valid && draft !== "auto" && (
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
          {t("settings.focusInvalidColor")}
        </Text>
      )}
    </View>
  );
}

export function FocusReadingSettings({
  value,
  onChange,
}: { value?: Partial<FocusConfig>; onChange: (value: FocusConfig) => void }) {
  const colors = useColors();
  const { t } = useTranslation();
  const config = normalizeFocusReading(value);
  const update = (updates: Partial<FocusConfig>) => {
    setPlaying(false);
    onChange({ ...config, ...updates });
  };
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const isFocused = useIsFocused();
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") setPlaying(false);
    });
    return () => listener.remove();
  }, []);
  const fragments = splitFocusText(t("settings.focusSample")).filter((part) => part.trim());
  useEffect(() => {
    if (!playing || !isFocused || !config.flashEnabled || config.flashInterval === 0) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % fragments.length),
      config.flashInterval * 1000,
    );
    return () => clearInterval(timer);
  }, [playing, isFocused, config.flashInterval, config.flashEnabled, fragments.length]);
  const part = focusFragment(fragments[index % fragments.length] ?? "");
  const escapeHtml = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
    );
  const first = readableFocusColor(config.gradientColor1, colors.background, colors.foreground);
  const second = readableFocusColor(config.gradientColor2, colors.background, colors.foreground);
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:8px 14px;background:${colors.background};color:${colors.foreground};font:17px/1.9 serif}p{margin:0;${config.gradientEnabled ? `background-image:${focusGradient(first, second, colors.foreground)};background-clip:text;-webkit-background-clip:text;color:transparent;` : ""}}</style></head><body><p>${escapeHtml(t("settings.focusSample"))}</p></body></html>`;
  const labelStyle = { color: colors.foreground, fontSize: 14 };
  const hintStyle = { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 };
  const buttonStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  };
  return (
    <View style={{ gap: 16, padding: 16, borderRadius: 12, backgroundColor: colors.card }}>
      <View style={{ gap: 5 }}>
        <Text style={{ ...labelStyle, fontWeight: "600" }}>{t("settings.focusTitle")}</Text>
        <Text style={hintStyle}>{t("settings.focusDesc")}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={labelStyle}>{t("settings.focusGradient")}</Text>
          <Text style={hintStyle}>{t("settings.focusGradientDesc")}</Text>
        </View>
        <Switch
          accessibilityLabel={t("settings.focusGradient")}
          value={config.gradientEnabled}
          onValueChange={(checked) => update({ gradientEnabled: checked })}
          trackColor={{ true: colors.primary }}
        />
      </View>
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          overflow: "hidden",
          backgroundColor: colors.background,
        }}
      >
        <Text style={{ ...hintStyle, padding: 12, paddingBottom: 0 }}>
          {t("settings.focusPreview")}
        </Text>
        <WebView
          originWhitelist={["about:blank"]}
          onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          scrollEnabled={false}
          javaScriptEnabled={false}
          source={{ html }}
          style={{ height: 132, backgroundColor: colors.background }}
        />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {FOCUS_PALETTES.map((palette) => (
          <Pressable
            key={palette.id}
            accessibilityRole="button"
            accessibilityState={{
              selected:
                config.gradientColor1 === palette.colors[0] &&
                config.gradientColor2 === palette.colors[1],
            }}
            onPress={() =>
              update({ gradientColor1: palette.colors[0], gradientColor2: palette.colors[1] })
            }
            style={{
              ...buttonStyle,
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              borderColor:
                config.gradientColor1 === palette.colors[0] &&
                config.gradientColor2 === palette.colors[1]
                  ? colors.primary
                  : colors.border,
            }}
          >
            <View style={{ flexDirection: "row" }}>
              {palette.colors.map((color) => (
                <View
                  key={color}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: color,
                    marginRight: -3,
                  }}
                />
              ))}
            </View>
            <Text style={{ ...labelStyle, fontSize: 12 }}>
              {t(`settings.focus${palette.id[0].toUpperCase()}${palette.id.slice(1)}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <ColorField
          label={t("settings.focusColor1")}
          value={config.gradientColor1}
          onChange={(value) => update({ gradientColor1: value })}
        />
        <ColorField
          label={t("settings.focusColor2")}
          value={config.gradientColor2}
          onChange={(value) => update({ gradientColor2: value })}
        />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          borderTopWidth: 1,
          borderColor: colors.border,
          paddingTop: 16,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={labelStyle}>{t("settings.focusFlash")}</Text>
          <Text style={hintStyle}>{t("settings.focusFlashDesc")}</Text>
        </View>
        <Switch
          accessibilityLabel={t("settings.focusFlash")}
          value={config.flashEnabled}
          onValueChange={(checked) => update({ flashEnabled: checked })}
          trackColor={{ true: colors.primary }}
        />
      </View>
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          paddingVertical: 18,
          backgroundColor: colors.background,
          gap: 18,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8 }}>
          <Text
            style={{
              flex: 1,
              textAlign: "right",
              fontSize: 20,
              color: config.flashTextColor === "auto" ? colors.foreground : config.flashTextColor,
            }}
            numberOfLines={1}
          >
            {part.before}
          </Text>
          <View>
            <View
              style={{
                position: "absolute",
                top: -10,
                left: "50%",
                height: 7,
                width: 1,
                backgroundColor: colors.mutedForeground,
              }}
            />
            <Text
              style={{
                fontSize: 20,
                color: readableFocusColor(
                  config.flashHighlightColor,
                  colors.background,
                  colors.foreground,
                ),
              }}
            >
              {part.anchor}
            </Text>
            <View
              style={{
                position: "absolute",
                bottom: -10,
                left: "50%",
                height: 7,
                width: 1,
                backgroundColor: colors.mutedForeground,
              }}
            />
          </View>
          <Text
            style={{
              flex: 1.5,
              fontSize: 20,
              color: config.flashTextColor === "auto" ? colors.foreground : config.flashTextColor,
            }}
            numberOfLines={1}
          >
            {part.after}
          </Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            disabled={!config.flashEnabled || config.flashInterval === 0}
            onPress={() => setPlaying((v) => !v)}
            style={{
              ...buttonStyle,
              opacity: !config.flashEnabled || config.flashInterval === 0 ? 0.4 : 1,
            }}
          >
            <Text style={labelStyle}>
              {t(playing ? "settings.focusPause" : "settings.focusPlay")}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.focusNext")}
            style={buttonStyle}
            onPress={() => {
              setPlaying(false);
              setIndex((i) => (i + 1) % fragments.length);
            }}
          >
            <Text style={labelStyle}>→</Text>
          </Pressable>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={labelStyle}>{t("settings.focusInterval")}</Text>
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("settings.focusInterval")} − 0.1 s`}
            disabled={config.flashInterval === 0}
            style={buttonStyle}
            onPress={() =>
              update({
                flashInterval: Math.max(0, Math.round((config.flashInterval - 0.1) * 10) / 10),
              })
            }
          >
            <Text style={labelStyle}>−</Text>
          </Pressable>
          <Text style={{ ...labelStyle, fontVariant: ["tabular-nums"] }}>
            {config.flashInterval === 0
              ? t("settings.focusManual")
              : `${config.flashInterval.toFixed(1)} s`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("settings.focusInterval")} + 0.1 s`}
            disabled={config.flashInterval === 2}
            style={buttonStyle}
            onPress={() =>
              update({
                flashInterval: Math.min(2, Math.round((config.flashInterval + 0.1) * 10) / 10),
              })
            }
          >
            <Text style={labelStyle}>+</Text>
          </Pressable>
        </View>
        <Text style={hintStyle}>{t("settings.focusIntervalHint")}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <ColorField
          label={t("settings.focusTextColor")}
          value={config.flashTextColor}
          onChange={(value) => update({ flashTextColor: value })}
        />
        <ColorField
          label={t("settings.focusAnchorColor")}
          value={config.flashHighlightColor}
          onChange={(value) => update({ flashHighlightColor: value })}
        />
      </View>
      <Pressable accessibilityRole="button" onPress={() => update({ flashTextColor: "auto" })}>
        <Text style={{ ...hintStyle, textDecorationLine: "underline" }}>
          {t("settings.focusTextColor")} · {t("settings.focusAuto")}
        </Text>
      </Pressable>
      <Text style={hintStyle}>{t("settings.focusScope")}</Text>
    </View>
  );
}
