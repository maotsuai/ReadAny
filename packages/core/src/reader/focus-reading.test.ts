import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FOCUS_READING,
  focusFragment,
  focusGradient,
  focusPagePhase,
  graphemes,
  normalizeFocusReading,
  splitFocusText,
} from "./focus-reading";
import { readableFocusColor, turnFocusPage } from "./focus-reading-dom";

describe("focus settings", () => {
  it("defaults old settings to both features off", () =>
    expect(normalizeFocusReading()).toEqual(DEFAULT_FOCUS_READING));
  it("clamps timing to 0–2 s and rounds to tenths", () => {
    for (const [input, output] of [
      [-1, 0],
      [0, 0],
      [0.1, 0.1],
      [0.26, 0.3],
      [2, 2],
      [99, 2],
      [Number.NaN, 0.5],
      [Number.POSITIVE_INFINITY, 0.5],
    ])
      expect(normalizeFocusReading({ flashInterval: input }).flashInterval).toBe(output);
  });
  it("rejects invalid and injected CSS colors", () => {
    expect(
      normalizeFocusReading({
        gradientColor1: "red);background:url(https://invalid)",
        flashHighlightColor: "#abc",
        flashTextColor: "transparent",
      }),
    ).toEqual(DEFAULT_FOCUS_READING);
    expect(normalizeFocusReading({ gradientColor1: "#Aa00FF" }).gradientColor1).toBe("#aa00ff");
  });
});
describe("focus phrases", () => {
  it.each([
    "宗先生对艺术确有很多话要说，宗先生是那么热爱它。我知道，并且碰到过好几次。",
    "Read at your own pace. Keep punctuation, and spaces!\nNext paragraph.",
    "中文 English 混合。日本語の文章、次へ。",
    "👩🏽‍💻 hello e\u0301! 家庭👨‍👩‍👧‍👦 𠮷野家。",
    "    \n\t",
    "",
    "supercalifragilisticexpialidocious",
  ])("preserves every character in %s", (text) => {
    expect(splitFocusText(text).join("")).toBe(text);
    expect(splitFocusText(text).every((part) => graphemes(part).length <= 22)).toBe(true);
  });
  it("does not split joined emoji or combining accents", () =>
    expect(graphemes("👩🏽‍💻e\u0301")).toEqual(["👩🏽‍💻", "e\u0301"]));
  it("retains joined emoji, modifiers and flags without Intl.Segmenter", () => {
    vi.stubGlobal("Intl", { Segmenter: undefined });
    try {
      expect(graphemes("👩🏽‍💻e\u0301🇨🇳")).toEqual(["👩🏽‍💻", "e\u0301", "🇨🇳"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("anchors a letter rather than punctuation", () => {
    for (const text of ["“本质的东西，", "阅读的节奏。", "hello!", "A", "👩🏽‍💻 e\u0301!"]) {
      const part = focusFragment(text);
      expect(part.before + part.anchor + part.after).toBe(text.trim());
      expect(part.anchor).toMatch(/[\p{L}\p{N}]/u);
    }
    expect(focusFragment("")).toEqual({ before: "", anchor: "", after: "" });
  });
});
describe("color path and page continuation", () => {
  it("uses stable position-dependent phases and a diagonal repeating gradient", () => {
    expect(focusPagePhase("chapter1/page1")).toBe(focusPagePhase("chapter1/page1"));
    expect(focusPagePhase("chapter1/page1")).not.toBe(focusPagePhase("chapter1/page2"));
    expect(focusGradient("#355fbe", "#ac3939", "#222222")).toContain(
      "repeating-linear-gradient(155deg",
    );
  });
  it("adapts dark pigments to night paper", () => {
    expect(readableFocusColor("#355fbe", "#ffffff", "#222222")).toBe("#355fbe");
    expect(readableFocusColor("#355fbe", "#121212", "#f5f5f5")).not.toBe("#355fbe");
    expect(readableFocusColor("#ffffff", "#ffffff", "#222222")).not.toBe("#ffffff");
  });
  it("waits for relocate", async () => {
    const target = new EventTarget();
    let settled = false;
    const wait = turnFocusPage(target, () => target.dispatchEvent(new Event("relocate"))).then(
      () => {
        settled = true;
      },
    );
    expect(settled).toBe(false);
    await wait;
    expect(settled).toBe(true);
  });
  it("cleans up on book end and propagates page errors", async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const wait = turnFocusPage(target, () => {});
    await vi.advanceTimersByTimeAsync(2500);
    await wait;
    expect(vi.getTimerCount()).toBe(0);
    const error = new Error("page unavailable");
    await expect(
      turnFocusPage(target, () => {
        throw error;
      }),
    ).rejects.toThrow(error);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
