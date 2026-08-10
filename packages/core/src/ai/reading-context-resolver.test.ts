import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingContext } from "../types/chat";

const getChunksMock = vi.hoisted(() => vi.fn());
const getFallbackChaptersMock = vi.hoisted(() => vi.fn());

vi.mock("../db/database", () => ({
  getChunkOutlines: getChunksMock,
}));

vi.mock("./fallback-source-resolver", () => ({
  getFallbackChaptersForBook: getFallbackChaptersMock,
}));

import { resolveReadingChapterIndex } from "./reading-context-resolver";

const context: ReadingContext = {
  bookId: "book-1",
  bookTitle: "Book",
  currentChapter: { index: 4, title: "Chapter Five", href: "chapter-5.xhtml" },
  currentPosition: { cfi: "epubcfi(/6/10)", percentage: 0.4 },
  surroundingText: "visible text",
  recentHighlights: [],
  operationType: "reading",
  timestamp: 1,
};

describe("resolveReadingChapterIndex", () => {
  beforeEach(() => {
    getChunksMock.mockReset();
    getFallbackChaptersMock.mockReset();
  });

  it("does not parse the original file for a lightweight context read", async () => {
    const result = await resolveReadingChapterIndex({
      bookId: "book-1",
      context,
      indexed: false,
      allowFallbackExtraction: false,
    });

    expect(result).toBeUndefined();
    expect(getFallbackChaptersMock).not.toHaveBeenCalled();
  });

  it("uses the cached/original chapter map when a content tool requires it", async () => {
    getFallbackChaptersMock.mockResolvedValue({
      book: { id: "book-1" },
      chapters: [{ index: 7, title: "Chapter Five", content: "content", segments: [] }],
    });

    const result = await resolveReadingChapterIndex({
      bookId: "book-1",
      context,
      indexed: false,
    });

    expect(result).toBe(7);
    expect(getFallbackChaptersMock).toHaveBeenCalledOnce();
  });
});
