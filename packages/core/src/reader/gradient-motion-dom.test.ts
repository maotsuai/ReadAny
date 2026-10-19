import { describe, expect, it } from "vitest";
import { normalizeFocusReading } from "./focus-reading";
import { GradientAnimation } from "./gradient-motion-dom";

function surface(reduced = false) {
  const frames = new Map<number, FrameRequestCallback>();
  const properties = new Map<string, string>();
  const media = Object.assign(new EventTarget(), { matches: reduced });
  const win = Object.assign(new EventTarget(), {
    frameElement: null,
    matchMedia: () => media,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++count;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  let count = 0;
  const doc = Object.assign(new EventTarget(), { hidden: false, defaultView: win });
  const element = {
    ownerDocument: doc,
    isConnected: true,
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
  };
  return {
    element,
    properties,
    frames,
    media,
    win,
    doc,
    animate: () => new GradientAnimation(element as unknown as HTMLElement),
    step: (time: number) => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
    },
  };
}
const config = normalizeFocusReading({ gradientEnabled: true, gradientMotionEnabled: true });

describe("gradient lifecycle", () => {
  it("changes paint while running, freezes when inactive, and releases its frame on destroy", () => {
    const scene = surface();
    const animation = scene.animate();
    animation.update(config, "#222222", "#ffffff");
    scene.step(60);
    scene.step(120);
    expect(scene.element.dataset.readanyGradientState).toBe("running");
    expect(scene.properties.get("--readany-focus-motion-shift")).not.toBe("0.00000em");
    animation.setActive(false);
    const frozen = scene.properties.get("--readany-focus-motion-shift");
    scene.step(200000);
    expect(scene.frames.size).toBe(0);
    expect(scene.properties.get("--readany-focus-motion-shift")).toBe(frozen);
    animation.setActive(true);
    expect(scene.frames.size).toBe(1);
    animation.destroy();
    expect(scene.frames.size).toBe(0);
    expect(scene.properties.size).toBe(0);
  });
  it("starts static for reduced motion and reacts to preference changes", () => {
    const scene = surface(true);
    const animation = scene.animate();
    animation.update(config, "#222222", "#ffffff");
    expect(scene.frames.size).toBe(0);
    expect(scene.element.dataset.readanyGradientState).toBe("reduced");
    expect(scene.properties.get("--readany-focus-motion-shift")).toBe("0em");
    scene.media.matches = false;
    scene.media.dispatchEvent(new Event("change"));
    expect(scene.frames.size).toBe(1);
    scene.media.matches = true;
    scene.media.dispatchEvent(new Event("change"));
    expect(scene.frames.size).toBe(0);
    animation.destroy();
    scene.media.matches = false;
    scene.media.dispatchEvent(new Event("change"));
    expect(scene.frames.size).toBe(0);
  });
  it("honors native reduced motion across ordinary settings updates", () => {
    const scene = surface();
    const animation = scene.animate();
    animation.update(config, "#222222", "#ffffff");
    animation.setReducedMotion(true);
    animation.update({ ...config, gradientMotionMode: "prism" }, "#222222", "#ffffff");
    expect(scene.frames.size).toBe(0);
    expect(scene.element.dataset.readanyGradientState).toBe("reduced");
    animation.destroy();
  });
  it("stops for a background document or detached iframe", () => {
    const scene = surface();
    const animation = scene.animate();
    animation.update(config, "#222222", "#ffffff");
    scene.doc.hidden = true;
    scene.doc.dispatchEvent(new Event("visibilitychange"));
    expect(scene.frames.size).toBe(0);
    scene.doc.hidden = false;
    scene.doc.dispatchEvent(new Event("visibilitychange"));
    expect(scene.frames.size).toBe(1);
    scene.element.isConnected = false;
    scene.step(100);
    expect(animation.disposed).toBe(true);
    expect(scene.frames.size).toBe(0);
  });
});
