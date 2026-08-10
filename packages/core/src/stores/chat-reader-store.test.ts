import { beforeEach, describe, expect, it, vi } from "vitest";

const kvGetItemMock = vi.hoisted(() => vi.fn());
const kvSetItemMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/platform", () => ({
  getPlatformService: () => ({
    kvGetItem: kvGetItemMock,
    kvSetItem: kvSetItemMock,
  }),
}));

import { useChatReaderStore } from "./chat-reader-store";

describe("chat reader selected-book context", () => {
  beforeEach(() => {
    kvGetItemMock.mockReset();
    kvSetItemMock.mockClear();
    useChatReaderStore.getState().clearContext();
  });

  it("deduplicates and awaits restoration for the active thread", async () => {
    let resolveLoad: (value: string | null) => void = () => undefined;
    kvGetItemMock.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const first = useChatReaderStore.getState().setActiveThreadContext("thread-1");
    const second = useChatReaderStore.getState().setActiveThreadContext("thread-1");

    expect(first).toBe(second);
    expect(useChatReaderStore.getState().selectedBooks).toEqual([]);
    await Promise.resolve();
    expect(kvGetItemMock).toHaveBeenCalledTimes(1);
    resolveLoad(JSON.stringify(["book-1", "book-2", "book-1"]));
    await first;

    expect(useChatReaderStore.getState().selectedBooks).toEqual(["book-1", "book-2"]);
    expect(kvSetItemMock).not.toHaveBeenCalled();
  });

  it("ignores a stale restoration after switching threads", async () => {
    let resolveFirst: (value: string | null) => void = () => undefined;
    kvGetItemMock
      .mockReturnValueOnce(
        new Promise<string | null>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(JSON.stringify(["book-current"]));

    const first = useChatReaderStore.getState().setActiveThreadContext("thread-old");
    await useChatReaderStore.getState().setActiveThreadContext("thread-current");
    resolveFirst(JSON.stringify(["book-stale"]));
    await first;

    expect(useChatReaderStore.getState().activeThreadContextId).toBe("thread-current");
    expect(useChatReaderStore.getState().selectedBooks).toEqual(["book-current"]);
  });
});
