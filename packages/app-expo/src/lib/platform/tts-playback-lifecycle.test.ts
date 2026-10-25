import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { TTSPlayState } from "../../stores/tts-store";
import { observeTTSPlayback } from "./tts-playback-lifecycle";

function createPlayback() {
  const store = createStore(() => ({
    playState: "stopped" as TTSPlayState,
    currentBookId: "book-1",
    currentLocationCfi: "cfi-1",
  }));
  const effects = {
    setRuntimeActive: vi.fn(async (_active: boolean) => {}),
    savePosition: vi.fn(async (_bookId: string, _cfi: string) => {}),
  };
  const cleanup = observeTTSPlayback(store, effects);
  return { store, effects, cleanup };
}

describe("TTS background lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the runtime active beyond 30 seconds and releases it on pause", () => {
    const { store, effects, cleanup } = createPlayback();
    store.setState({ playState: "loading" });
    store.setState({ playState: "playing" });
    vi.advanceTimersByTime(60_000);
    expect(effects.setRuntimeActive.mock.calls).toEqual([[true]]);

    store.setState({ playState: "paused" });
    expect(effects.setRuntimeActive.mock.calls).toEqual([[true], [false]]);
    store.setState({ playState: "playing" });
    expect(effects.setRuntimeActive.mock.calls).toEqual([[true], [false], [true]]);
    cleanup();
  });

  it("saves each spoken location independently of reader renders", () => {
    const { store, effects, cleanup } = createPlayback();
    store.setState({ playState: "playing" });
    store.setState({ currentLocationCfi: "cfi-2" });
    store.setState({ currentLocationCfi: "cfi-3" });
    store.setState({ playState: "paused" });
    expect(effects.savePosition.mock.calls).toEqual([
      ["book-1", "cfi-1"],
      ["book-1", "cfi-2"],
      ["book-1", "cfi-3"],
    ]);
    cleanup();
  });

  it("keeps the runtime through chapter handoff and releases it after a real stop", () => {
    const { store, effects, cleanup } = createPlayback();
    store.setState({ playState: "playing" });
    store.setState({ playState: "stopped" });
    vi.advanceTimersByTime(1_000);
    store.setState({ playState: "loading" });
    vi.advanceTimersByTime(5_000);
    expect(effects.setRuntimeActive.mock.calls).toEqual([[true]]);

    store.setState({ playState: "stopped" });
    vi.advanceTimersByTime(5_000);
    expect(effects.setRuntimeActive.mock.calls).toEqual([[true], [false]]);
    cleanup();
  });

  it("does not extend the stop grace period when unrelated state changes", () => {
    const { store, effects, cleanup } = createPlayback();
    store.setState({ playState: "playing" });
    store.setState({ playState: "stopped" });
    vi.advanceTimersByTime(4_000);
    store.setState({ currentLocationCfi: "cfi-2" });
    vi.advanceTimersByTime(1_000);
    expect(effects.setRuntimeActive.mock.calls).toEqual([[true], [false]]);
    cleanup();
  });
});
