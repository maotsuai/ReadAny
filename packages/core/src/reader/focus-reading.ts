import type { FocusReadingSettings } from "../types/book";

export const DEFAULT_FOCUS_READING: Readonly<FocusReadingSettings> = {
  gradientEnabled: false,
  gradientColor1: "#355fbe",
  gradientColor2: "#ac3939",
  gradientMotionEnabled: false,
  gradientMotionMode: "flow",
  gradientCycleMin: 20,
  gradientCycleMax: 45,
  flashEnabled: false,
  flashInterval: 0.5,
  flashTextColor: "auto",
  flashHighlightColor: "#c4473a",
};

export const FOCUS_PALETTES = [
  { id: "classic", colors: ["#355fbe", "#ac3939"] },
  { id: "ocean", colors: ["#226b8c", "#7350a2"] },
  { id: "forest", colors: ["#397354", "#986126"] },
  { id: "sunset", colors: ["#ad4338", "#865b29"] },
  { id: "electric", colors: ["#1849d6", "#b51f50"] },
  { id: "amber", colors: ["#0648bb", "#9c4a00"] },
  { id: "orchid", colors: ["#007451", "#a12888"] },
  { id: "signal", colors: ["#4f2db7", "#c13b19"] },
] as const;

export const GRADIENT_MOTION_MODES = ["flow", "tide", "aurora", "prism", "wash"] as const;
export const GRADIENT_CYCLE_LIMITS = { min: 1, max: 120, gap: 1 } as const;

/** Keep a real random range even when imported values request a fixed speed. */
export function normalizeGradientRange(min?: number, max?: number): [number, number] {
  const limits = GRADIENT_CYCLE_LIMITS;
  const bound = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(Math.max(limits.min, Math.min(limits.max, value)))
      : fallback;
  const a = bound(min, 20);
  const b = bound(max, 45);
  const lower = Math.min(limits.max - limits.gap, Math.min(a, b));
  return [lower, Math.max(lower + limits.gap, Math.max(a, b))];
}

export function normalizeFocusReading(
  value?: Partial<FocusReadingSettings> | null,
): FocusReadingSettings {
  const color = (v: unknown, fallback: string) =>
    typeof v === "string" && /^#[\da-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
  const interval = value?.flashInterval;
  const [gradientCycleMin, gradientCycleMax] = normalizeGradientRange(
    value?.gradientCycleMin,
    value?.gradientCycleMax,
  );
  return {
    gradientEnabled: value?.gradientEnabled === true,
    gradientColor1: color(value?.gradientColor1, DEFAULT_FOCUS_READING.gradientColor1),
    gradientColor2: color(value?.gradientColor2, DEFAULT_FOCUS_READING.gradientColor2),
    gradientMotionEnabled: value?.gradientMotionEnabled === true,
    gradientMotionMode:
      GRADIENT_MOTION_MODES.find((mode) => mode === value?.gradientMotionMode) ?? "flow",
    gradientCycleMin,
    gradientCycleMax,
    flashEnabled: value?.flashEnabled === true,
    flashInterval:
      interval === -1
        ? -1
        : typeof interval === "number" && Number.isFinite(interval)
          ? Math.round(Math.min(2, Math.max(0, interval)) * 10) / 10
          : DEFAULT_FOCUS_READING.flashInterval,
    flashTextColor: color(value?.flashTextColor, "auto"),
    flashHighlightColor: color(
      value?.flashHighlightColor,
      DEFAULT_FOCUS_READING.flashHighlightColor,
    ),
  };
}

/** Discrete controls include -1, 0, 0.1 … 2, with no intermediate negative values. */
export function stepFlashInterval(interval: number, direction: 1 | -1): number {
  const position = interval === -1 ? -1 : Math.round(interval * 10);
  const next = Math.max(-1, Math.min(20, position + direction));
  return next === -1 ? -1 : next / 10;
}

/** Also guards re-enabling gradient colors while animated colors are selected. */
export function needsMotionConfirmation(before: FocusReadingSettings, after: FocusReadingSettings) {
  return (
    after.gradientEnabled &&
    after.gradientMotionEnabled &&
    !(before.gradientEnabled && before.gradientMotionEnabled)
  );
}

export function focusPagePhase(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  return (hash >>> 0) % 997;
}

export function focusGradient(color1: string, color2: string, base: string): string {
  // A line moves ~1.6em vertically through an ~8.8em vertical cycle. This
  // deliberately avoids the long vertical color bands of horizontal gradients.
  return `repeating-linear-gradient(155deg, ${color1} 0em, ${base} 2em, ${color2} 4em, ${base} 6em, ${color1} 8em)`;
}

export function graphemes(text: string): string[] {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: string },
      ) => {
        segment: (text: string) => Iterable<{ segment: string }>;
      };
    }
  ).Segmenter;
  if (Segmenter)
    return Array.from(
      new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      (part) => part.segment,
    );
  // Older WebViews: retain marks, variation selectors and joined emoji.
  return (
    text.match(
      /\p{Regional_Indicator}{2}|\P{M}(?:\p{M}|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}])*(?:\u200D\P{M}(?:\p{M}|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}])*)*|\p{M}+/gu,
    ) ?? []
  );
}

/** Chinese/Japanese phrases up to seven graphemes; other scripts by word.
 * Whitespace and punctuation are retained so joining fragments loses no text. */
export function splitFocusText(text: string): string[] {
  const result: string[] = [];
  let buffer = "";
  let count = 0;
  let cjk = false;
  const flush = () => {
    if (buffer) result.push(buffer);
    buffer = "";
    count = 0;
  };
  for (const char of graphemes(text)) {
    const isCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char);
    const word = /[\p{L}\p{N}]/u.test(char);
    if (word && count && isCjk !== cjk) flush();
    if (word) cjk = isCjk;
    buffer += char;
    count++;
    if (
      (cjk && count >= 7) ||
      count >= 18 ||
      /[，。！？；、,.!?;:\n]/u.test(char) ||
      (!cjk && /\s/u.test(char))
    )
      flush();
  }
  flush();
  // Keep punctuation-only / whitespace-only pieces attached to their words.
  return result.reduce<string[]>((parts, part) => {
    if (!/[\p{L}\p{N}\p{S}]/u.test(part) && parts.length) parts[parts.length - 1] += part;
    else parts.push(part);
    return parts;
  }, []);
}

export function focusFragment(text: string): { before: string; anchor: string; after: string } {
  const chars = graphemes(text.trim());
  const eligible = chars
    .map((char, i) => (/[\p{L}\p{N}]/u.test(char) ? i : -1))
    .filter((i) => i >= 0);
  const index = eligible[Math.min(eligible.length - 1, Math.floor(eligible.length * 0.35))] ?? 0;
  return {
    before: chars.slice(0, index).join(""),
    anchor: chars[index] ?? "",
    after: chars.slice(index + 1).join(""),
  };
}

export function focusLabels(t: (key: string) => string): Record<string, string> {
  const keys = {
    title: "focusFlash",
    play: "focusPlay",
    pause: "focusPause",
    close: "focusClose",
    previous: "focusPrevious",
    next: "focusNext",
    settings: "focusSettings",
    hint: "focusHint",
    manual: "focusManual",
    swipe: "focusSwipe",
    swipeHint: "focusSwipeHint",
    previousPage: "focusPreviousPage",
    nextPage: "focusNextPage",
    empty: "focusEmpty",
  };
  return Object.fromEntries(
    Object.entries(keys).map(([key, value]) => [key, t(`settings.${value}`)]),
  );
}
