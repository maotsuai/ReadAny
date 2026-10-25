import { DEFAULT_TTS_CONFIG, type ITTSPlayer } from "@readany/core/tts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("react-native-track-player", () => ({
  default: {
    getActiveTrackIndex: vi.fn(() => Promise.resolve(undefined)),
    updateMetadataForTrack: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("./persist", () => ({
  withPersist: (_key: string, creator: unknown) => creator,
}));
vi.mock("../lib/platform/system-tts-synthesis", () => ({
  canUseSystemTtsSynthesis: () => true,
}));
vi.mock("../lib/platform/expo-speech-player", () => ({ ExpoSpeechTTSPlayer: class {} }));
vi.mock("../lib/platform/track-player-system-player", () => ({
  TrackPlayerSystemTTSPlayer: class {},
}));
vi.mock("../lib/platform/track-player-edge-player", () => ({
  TrackPlayerEdgeTTSPlayer: class {},
}));
vi.mock("../lib/platform/track-player-dashscope-player", () => ({
  TrackPlayerDashScopeTTSPlayer: class {},
}));
vi.mock("../lib/platform/track-player-cloud-tts-player", () => ({
  TrackPlayerCloudTTSPlayer: class {},
}));

const { setTTSPlayerFactories, useTTSStore } = await import("./tts-store");

type MockPlayer = ITTSPlayer & {
  speak: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onError?: (error: Error) => void;
};

function createPlayer(): MockPlayer {
  const player = {
    speak: vi.fn(() => player.onStateChange?.("playing")),
    pause: vi.fn(),
    resume: vi.fn(),
    append: vi.fn(),
    stop: vi.fn(() => {
      player.onStateChange?.("stopped");
      player.onEnd?.();
    }),
  } as MockPlayer;
  return player;
}

describe("Expo TTS sessions", () => {
  let systemPlayer: MockPlayer;
  let dashscopePlayer: MockPlayer;

  beforeEach(() => {
    systemPlayer = createPlayer();
    dashscopePlayer = createPlayer();
    setTTSPlayerFactories({
      createSystemTTS: () => systemPlayer,
      createDashScopeTTS: () => dashscopePlayer,
    });
    useTTSStore.setState({
      config: DEFAULT_TTS_CONFIG,
      playState: "stopped",
      currentText: "",
      currentSegmentText: "",
      onEnd: null,
    });
    useTTSStore.getState().stop();
    useTTSStore.getState().updateConfig({ engine: "system" });
    vi.clearAllMocks();
  });

  it("uses the DashScope player even when its API key is missing", () => {
    useTTSStore.getState().updateConfig({ engine: "dashscope", dashscopeApiKey: "" });

    useTTSStore.getState().play("test sentence");

    expect(dashscopePlayer.speak).toHaveBeenCalledOnce();
    expect(systemPlayer.speak).not.toHaveBeenCalled();
  });

  it("stops on a provider error without firing the reader onEnd", () => {
    const onEnd = vi.fn();
    useTTSStore.getState().updateConfig({ engine: "dashscope", dashscopeApiKey: "key" });
    useTTSStore.getState().setOnEnd(onEnd);
    useTTSStore.getState().play(["first", "second"]);

    dashscopePlayer.onError?.(new Error("request failed"));

    expect(onEnd).not.toHaveBeenCalled();
    expect(useTTSStore.getState().playState).toBe("stopped");
  });

  it("tracks spoken CFIs without a mounted reader, preserving alignment across empty segments", () => {
    useTTSStore.getState().play(["first", "  ", "third"], ["cfi-1", "cfi-2", "cfi-3"]);

    systemPlayer.onChunkChange?.(1, 2);

    expect(useTTSStore.getState()).toMatchObject({
      currentChunkIndex: 1,
      currentSegmentText: "third",
      currentLocationCfi: "cfi-3",
    });
  });

  it("keeps appended locations and absolute chunk positions after jumping", () => {
    useTTSStore.getState().play(["first", "second"], ["cfi-1", "cfi-2"]);
    useTTSStore.getState().append(["third", "fourth"], ["cfi-3", "cfi-4"]);
    const staleChunkChange = systemPlayer.onChunkChange;
    useTTSStore.getState().jumpToChunk(1);
    expect(useTTSStore.getState().currentLocationCfi).toBe("cfi-2");

    systemPlayer.onChunkChange?.(1, 3);
    staleChunkChange?.(0, 2);

    expect(useTTSStore.getState()).toMatchObject({
      currentChunkIndex: 2,
      currentSegmentText: "third",
      currentLocationCfi: "cfi-3",
      totalChunks: 4,
    });
  });

  it("resumes an interrupted provider from the last spoken segment", () => {
    useTTSStore.getState().play(["first", "second", "third"], ["cfi-1", "cfi-2", "cfi-3"]);
    systemPlayer.onChunkChange?.(1, 3);
    systemPlayer.onError?.(new Error("interrupted in background"));

    useTTSStore.getState().resume();

    expect(systemPlayer.speak).toHaveBeenLastCalledWith(["second", "third"], expect.anything());
    expect(useTTSStore.getState().currentLocationCfi).toBe("cfi-2");
    systemPlayer.onChunkChange?.(1, 2);
    expect(useTTSStore.getState().currentLocationCfi).toBe("cfi-3");
  });

  it("ignores repeated play commands while a player is already active", () => {
    useTTSStore.getState().play(["first", "second"], ["cfi-1", "cfi-2"]);
    systemPlayer.onChunkChange?.(1, 2);

    useTTSStore.getState().resume();
    useTTSStore.getState().resume();

    expect(systemPlayer.speak).toHaveBeenCalledOnce();
    expect(useTTSStore.getState().currentLocationCfi).toBe("cfi-2");
  });
});
