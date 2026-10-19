export function focusRgb(color: string): number[] {
  const hex = color.match(/^#([\da-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const values = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  return values?.length === 3 ? values : [255, 255, 255];
}
export function focusLuminance(values: number[]): number {
  return values
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
/** Keep custom hues readable against the active paper, including night mode. */
export function readableFocusColor(color: string, background: string, foreground: string): string {
  const start = focusRgb(color);
  const end = focusRgb(foreground);
  const bg = focusLuminance(focusRgb(background));
  for (let step = 0; step <= 20; step++) {
    const values = start.map((v, i) => Math.round(v + ((end[i] - v) * step) / 20));
    const lum = focusLuminance(values);
    if ((Math.max(lum, bg) + 0.05) / (Math.min(lum, bg) + 0.05) >= 4.5 || step === 20) {
      return `#${values.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return foreground;
}
