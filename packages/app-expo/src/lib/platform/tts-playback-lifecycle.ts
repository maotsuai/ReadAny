import type { StoreApi } from "zustand";
import type { TTSState } from "../../stores/tts-store";

// A natural queue end can immediately start another page/chapter. Keep the
// runtime alive across that handoff, but release it after a real stop.
const STOP_GRACE_MS = 5_000;
type PlaybackSnapshot = Pick<TTSState, "playState" | "currentBookId" | "currentLocationCfi">;

export function observeTTSPlayback(
  store: Pick<StoreApi<PlaybackSnapshot>, "getState" | "subscribe">,
  effects: {
    setRuntimeActive: (active: boolean) => Promise<void>;
    savePosition: (bookId: string, cfi: string) => Promise<void>;
  },
): () => void {
  let runtimeActive = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPosition = "";

  const setRuntimeActive = (active: boolean) => {
    if (runtimeActive === active) return;
    runtimeActive = active;
    void effects.setRuntimeActive(active).catch((error) => {
      console.warn("[TTS] Failed to update background runtime:", error);
    });
  };

  const sync = (state: PlaybackSnapshot) => {
    if (state.playState === "playing" || state.playState === "loading") {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      setRuntimeActive(true);
    } else if (state.playState === "paused") {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      setRuntimeActive(false);
    } else if (runtimeActive && !releaseTimer) {
      releaseTimer = setTimeout(() => {
        releaseTimer = undefined;
        setRuntimeActive(false);
      }, STOP_GRACE_MS);
    }

    // This subscription runs on native chunk callbacks, even when the reader
    // is unmounted or its WebView/React effects are suspended in the background.
    const { currentBookId, currentLocationCfi, playState } = state;
    const position = `${currentBookId}:${currentLocationCfi}`;
    if (
      playState !== "stopped" &&
      currentBookId &&
      currentLocationCfi &&
      position !== lastPosition
    ) {
      lastPosition = position;
      void effects.savePosition(currentBookId, currentLocationCfi).catch((error) => {
        if (lastPosition === position) lastPosition = "";
        console.warn("[TTS] Failed to save spoken position:", error);
      });
    }
  };

  const unsubscribe = store.subscribe(sync);
  sync(store.getState());
  return () => {
    unsubscribe();
    clearTimeout(releaseTimer);
    setRuntimeActive(false);
  };
}
