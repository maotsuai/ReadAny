import type { FocusReadingSettings } from "../types/book";
import { focusLuminance, focusRgb, readableFocusColor } from "./focus-colors";
import { normalizeGradientRange } from "./focus-reading";

export interface GradientMotionFrame {
  image: string;
  offset: number;
  colors: [string, string];
}
const TAU = Math.PI * 2;
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const srgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const rgbLinear = (color: string) => focusRgb(color).map((v) => linear(v / 255));
const y = (values: number[]) => values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
const hex = (values: number[]) =>
  `#${values
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, srgb(v))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** Retain the selected pigment's luminance while changing hue. No opacity
 * pulses, brightness modulation or saturated primary-color cycling. */
export function motionPigment(color: string, degrees: number): string {
  const [r, g, b] = rgbLinear(color);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const angle = Math.atan2(bb, a) + (degrees * Math.PI) / 180;
  let chroma = Math.min(0.14, Math.hypot(a, bb));
  const target = focusLuminance(focusRgb(color));
  for (let attempt = 0; attempt < 40; attempt++) {
    const aa = Math.cos(angle) * chroma;
    const ab = Math.sin(angle) * chroma;
    const ll = (lightness + 0.3963377774 * aa + 0.2158037573 * ab) ** 3;
    const mm = (lightness - 0.1055613458 * aa - 0.0638541728 * ab) ** 3;
    const ss = (lightness - 0.0894841775 * aa - 1.291485548 * ab) ** 3;
    const values = [
      4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss,
      -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss,
      -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss,
    ];
    const scale = target / Math.max(0.000001, y(values));
    const matched = values.map((v) => v * scale);
    if (matched.every((v) => v >= 0 && v <= 1)) return hex(matched);
    chroma *= 0.82;
  }
  return hex([target, target, target]);
}

function washPigment(a: string, b: string, weight: number): string {
  const first = rgbLinear(a);
  const second = rgbLinear(b);
  const target = y(first);
  const mixed = first.map((v, i) => v + (second[i] - v) * weight);
  const scale = target / Math.max(0.000001, y(mixed));
  const matched = mixed.map((v) => v * scale);
  // Reduce chroma towards equal-luminance gray if a channel leaves the gamut.
  let amount = 1;
  for (const v of matched) {
    if (v > 1) amount = Math.min(amount, (1 - target) / (v - target));
    if (v < 0) amount = Math.min(amount, target / (target - v));
  }
  return hex(matched.map((v) => target + (v - target) * amount));
}

// Leave headroom for 8-bit quantization after hue rotation and gamut mapping.
function readableMotionColor(color: string, foreground: string, background: string): string {
  const start = rgbLinear(readableFocusColor(color, background, foreground));
  const end = rgbLinear(foreground);
  const bg = focusLuminance(focusRgb(background));
  for (let step = 0; step <= 20; step++) {
    const candidate = hex(start.map((v, i) => v + ((end[i] - v) * step) / 20));
    const lum = focusLuminance(focusRgb(candidate));
    if ((Math.max(lum, bg) + 0.05) / (Math.min(lum, bg) + 0.05) >= 4.7) return candidate;
  }
  return foreground;
}

export function gradientMotionFrame(
  config: FocusReadingSettings,
  phase: number,
  foreground: string,
  background: string,
): GradientMotionFrame {
  const p = ((phase % 1) + 1) % 1;
  const wave = Math.sin(p * TAU);
  let angle = 155;
  let period = 8;
  let offset = 0;
  let first = motionPigment(readableMotionColor(config.gradientColor1, foreground, background), 0);
  let second = motionPigment(readableMotionColor(config.gradientColor2, foreground, background), 0);
  switch (config.gradientMotionMode) {
    case "flow":
      offset = (p * period) / Math.sin((angle * Math.PI) / 180);
      break;
    case "tide":
      offset = wave * 3;
      break;
    case "aurora":
      angle += wave * 6;
      period += Math.sin(p * TAU * 2) * 0.6;
      offset = wave * 1.5;
      first = motionPigment(first, wave * 38);
      second = motionPigment(second, -wave * 32);
      break;
    case "prism":
      first = motionPigment(first, p * 360);
      second = motionPigment(second, -p * 360);
      offset = (p * period) / Math.sin((angle * Math.PI) / 180);
      break;
    case "wash": {
      const weight = (1 - Math.cos(p * TAU)) * 0.28;
      const a = first;
      first = washPigment(a, second, weight);
      second = washPigment(second, a, weight);
      offset = wave * 0.8;
      break;
    }
  }
  return {
    image: `repeating-linear-gradient(${angle.toFixed(3)}deg, ${first} 0em, ${foreground} ${(period / 4).toFixed(3)}em, ${second} ${(period / 2).toFixed(3)}em, ${foreground} ${(period * 0.75).toFixed(3)}em, ${first} ${period.toFixed(3)}em)`,
    offset,
    colors: [first, second],
  };
}

/** Rate is always between 1/max and 1/min cycles per second. A new random
 * target every 3–7 s is eased into continuously; this is not a CSS loop with
 * one randomly chosen fixed duration. Hidden / delayed frames never catch up. */
export class RandomGradientClock {
  phase = 0;
  rate = 0;
  private from = 0;
  private target = 0;
  private elapsed = 0;
  private duration = 0;
  private timestamp: number | undefined;
  private min: number;
  private max: number;
  constructor(
    min: number,
    max: number,
    private random: () => number = Math.random,
  ) {
    [this.min, this.max] = normalizeGradientRange(min, max);
    this.rate = this.pickRate();
    this.nextTarget();
  }
  private unit() {
    const value = this.random();
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
  }
  private pickRate() {
    return 1 / (this.max - this.unit() * (this.max - this.min));
  }
  private nextTarget() {
    this.from = this.rate;
    this.target = this.pickRate();
    const span = 1 / this.min - 1 / this.max;
    if (Math.abs(this.target - this.from) < span * 0.08) {
      const unit = ((this.target - 1 / this.max) / span + 0.381966) % 1;
      this.target = 1 / this.max + unit * span;
    }
    this.elapsed = 0;
    this.duration = 3 + this.unit() * 4;
  }
  suspend() {
    this.timestamp = undefined;
  }
  tick(timestamp: number) {
    if (this.timestamp === undefined) {
      this.timestamp = timestamp;
      return this.phase;
    }
    const dt = Math.min(0.1, Math.max(0, (timestamp - this.timestamp) / 1000));
    this.timestamp = timestamp;
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.duration);
    const smooth = t * t * (3 - 2 * t);
    const previous = this.rate;
    this.rate = this.from + (this.target - this.from) * smooth;
    this.phase = (this.phase + (previous + this.rate) * 0.5 * dt) % 1;
    if (t === 1) this.nextTarget();
    return this.phase;
  }
}
