/**
 * react-native-track-player PlaybackService
 *
 * Required on Android to keep the foreground service alive for media playback.
 * Without this registration, some Android devices crash when TrackPlayer
 * attempts to start its ForegroundService.
 *
 * Remote events are registered once here, independently of the Activity.
 */
import { Platform } from "react-native";
import TrackPlayer, { Event } from "react-native-track-player";
import SystemTtsSynthesis from "../../modules/system-tts-synthesis";
import { observeTTSPlayback } from "../lib/platform/tts-playback-lifecycle";
import { useTTSStore } from "../stores/tts-store";

let lifecycleInitialized = false;
let remoteEventsRegistered = false;

export function initializeTTSPlaybackLifecycle(
  savePosition: (bookId: string, cfi: string) => Promise<void>,
): void {
  if (lifecycleInitialized) return;
  lifecycleInitialized = true;
  observeTTSPlayback(useTTSStore, {
    savePosition,
    setRuntimeActive: async (active) => {
      if (Platform.OS !== "android") return;
      if (!SystemTtsSynthesis.setPlaybackActive) {
        throw new Error("Background TTS runtime unavailable; native rebuild required");
      }
      await SystemTtsSynthesis.setPlaybackActive(active);
    },
  });
}

export async function PlaybackService() {
  if (remoteEventsRegistered) return;
  remoteEventsRegistered = true;
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    useTTSStore.getState().resume();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    useTTSStore.getState().pause();
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    useTTSStore.getState().stop();
    TrackPlayer.stop();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    const { currentChunkIndex, jumpToChunk, totalChunks } = useTTSStore.getState();
    const nextIndex = currentChunkIndex + 1;
    if (nextIndex < totalChunks) {
      jumpToChunk(nextIndex);
    }
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    const { currentChunkIndex, jumpToChunk } = useTTSStore.getState();
    const prevIndex = currentChunkIndex - 1;
    if (prevIndex >= 0) {
      jumpToChunk(prevIndex);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position);
  });
}
