import { describe, expect, it } from "vitest";
import { focusLuminance, focusRgb } from "./focus-colors";
import {
  FOCUS_PALETTES,
  GRADIENT_MOTION_MODES,
  normalizeFocusReading,
  normalizeGradientRange,
} from "./focus-reading";
import { RandomGradientClock, gradientMotionFrame, motionPigment } from "./gradient-motion";

describe("random gradient range", () => {
  it("defaults to static, permits 1 s cycles and refuses a fixed range", () => {
    expect(normalizeFocusReading().gradientMotionEnabled).toBe(false);
    expect(normalizeGradientRange()).toEqual([20, 45]);
    expect(normalizeGradientRange(1, 2)).toEqual([1, 2]);
    for (const [a, b] of [
      [0, 0],
      [20, 20],
      [120, 120],
      [99, 1],
      [Number.NaN, Number.POSITIVE_INFINITY],
    ]) {
      const [min, max] = normalizeGradientRange(a, b);
      expect(min).toBeGreaterThanOrEqual(1);
      expect(max).toBeLessThanOrEqual(120);
      expect(max - min).toBeGreaterThanOrEqual(1);
    }
    expect(
      normalizeFocusReading({ gradientMotionMode: "strobe" as "flow" }).gradientMotionMode,
    ).toBe("flow");
  });
  it("keeps the fastest random range bounded and smoothly changing", () => {
    const clock = new RandomGradientClock(1, 2, () => 0.5);
    const rates = new Set<number>();
    let previous = clock.rate;
    for (let timestamp = 0; timestamp <= 30000; timestamp += 50) {
      clock.tick(timestamp);
      expect(clock.rate).toBeGreaterThanOrEqual(0.5);
      expect(clock.rate).toBeLessThanOrEqual(1);
      expect(Math.abs(clock.rate - previous)).toBeLessThan(0.02);
      previous = clock.rate;
      rates.add(Number(clock.rate.toFixed(4)));
    }
    expect(rates.size).toBeGreaterThan(30);
  });
  it("continually varies velocity inside the range, including a constant RNG fallback", () => {
    const clock = new RandomGradientClock(8, 12, () => 0.5);
    const rates = new Set<number>();
    let previous = clock.rate;
    for (let timestamp = 0; timestamp <= 60000; timestamp += 50) {
      clock.tick(timestamp);
      expect(clock.rate).toBeGreaterThanOrEqual(1 / 12);
      expect(clock.rate).toBeLessThanOrEqual(1 / 8);
      expect(Math.abs(clock.rate - previous)).toBeLessThan(0.002);
      expect(clock.phase).toBeGreaterThanOrEqual(0);
      expect(clock.phase).toBeLessThan(1);
      rates.add(Number(clock.rate.toFixed(5)));
      previous = clock.rate;
    }
    expect(rates.size).toBeGreaterThan(30);
  });
  it("does not catch up when resumed or when frames are delayed", () => {
    const clock = new RandomGradientClock(20, 45, () => 0.5);
    clock.tick(0);
    clock.tick(50);
    const initial = clock.phase;
    clock.suspend();
    clock.tick(1000000);
    expect(clock.phase).toBe(initial);
    clock.tick(2000000);
    expect(clock.phase - initial).toBeLessThanOrEqual(0.1 / 20);
  });
});

describe("quiet color modes", () => {
  it("keeps hue rotation at approximately constant luminance, even for user-selected red", () => {
    for (const color of ["#355fbe", "#ac3939", "#ff0000", "#ffffff", "#000000"]) {
      const initial = focusLuminance(focusRgb(color));
      for (let hue = 0; hue < 360; hue += 8) {
        const pigment = motionPigment(color, hue);
        expect(pigment).toMatch(/^#[a-f\d]{6}$/);
        expect(Math.abs(focusLuminance(focusRgb(pigment)) - initial)).toBeLessThan(0.006);
        if (color === "#ff0000") {
          const channels = focusRgb(pigment);
          expect(channels[0] / channels.reduce((a, b) => a + b, 0)).toBeLessThan(0.8);
        }
      }
    }
  });
  it.each(GRADIENT_MOTION_MODES)(
    "%s closes its loop smoothly and does not animate opacity/background",
    (mode) => {
      const config = normalizeFocusReading({
        gradientMotionMode: mode,
        gradientEnabled: true,
        gradientMotionEnabled: true,
      });
      const start = gradientMotionFrame(config, 0, "#222222", "#ffffff");
      const end = gradientMotionFrame(config, 1, "#222222", "#ffffff");
      expect(start).toEqual(end);
      const frames = [0.1, 0.3, 0.6].map((phase) =>
        gradientMotionFrame(config, phase, "#222222", "#ffffff"),
      );
      expect(new Set(frames.map((frame) => JSON.stringify(frame))).size).toBe(3);
      expect(Object.keys(start).sort()).toEqual(["colors", "image", "offset"]);
      expect(start.image).not.toMatch(/opacity|filter|background-color/);
    },
  );
  it("retains text contrast in all modes on light, sepia and night paper", () => {
    for (const [foreground, background] of [
      ["#222222", "#ffffff"],
      ["#f5f5f5", "#121212"],
      ["#3d2b1f", "#f0e6d2"],
    ]) {
      for (const palette of FOCUS_PALETTES) {
        for (const mode of GRADIENT_MOTION_MODES) {
          const config = normalizeFocusReading({
            gradientMotionMode: mode,
            gradientColor1: palette.colors[0],
            gradientColor2: palette.colors[1],
          });
          const bg = focusLuminance(focusRgb(background));
          for (let phase = 0; phase < 1; phase += 0.03) {
            const frame = gradientMotionFrame(config, phase, foreground, background);
            for (const color of frame.colors) {
              const l = focusLuminance(focusRgb(color));
              expect((Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05)).toBeGreaterThanOrEqual(
                4.5,
              );
            }
          }
        }
      }
    }
  });
  it("leaves contrast headroom for user-selected colors near the readability threshold", () => {
    for (const color of ["#777777", "#faedcd", "#ff0000", "#00ff00", "#0000ff", "#597da2"]) {
      for (const [foreground, background] of [
        ["#222222", "#ffffff"],
        ["#f5f5f5", "#121212"],
        ["#3d2b1f", "#f0e6d2"],
      ]) {
        const bg = focusLuminance(focusRgb(background));
        for (const mode of GRADIENT_MOTION_MODES) {
          const config = normalizeFocusReading({
            gradientColor1: color,
            gradientColor2: color,
            gradientMotionMode: mode,
          });
          for (let phase = 0; phase < 1; phase += 0.06) {
            for (const pigment of gradientMotionFrame(config, phase, foreground, background)
              .colors) {
              const lum = focusLuminance(focusRgb(pigment));
              expect(
                (Math.max(lum, bg) + 0.05) / (Math.min(lum, bg) + 0.05),
              ).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
      }
    }
  });
});
