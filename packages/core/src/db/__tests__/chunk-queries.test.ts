import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chunk } from "../../types";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: vi.fn() };
const mockLocalDb = { execute: vi.fn(), select: vi.fn(), close: vi.fn() };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getLocalDB: vi.fn(),
  serializeEmbedding: vi.fn((emb?: number[]) => {
    if (!emb || emb.length === 0) return null;
    const buffer = new ArrayBuffer(emb.length * 4);
    const view = new Float32Array(buffer);
    for (let i = 0; i < emb.length; i++) view[i] = emb[i];
    return new Uint8Array(buffer);
  }),
  deserializeEmbedding: vi.fn((data: unknown) => {
    if (!data) return undefined;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    if (bytes.length === 0) return undefined;
    const view = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    return Array.from(view);
  }),
}));

vi.mock("../db-core", () => coreMocks);

const {
  getChunks,
  getChunksWithoutEmbeddings,
  getChapterChunks,
  getChunkOutlines,
  insertChunks,
  deleteChunks,
} = await import("../chunk-queries");

describe("chunk-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getLocalDB.mockResolvedValue(mockLocalDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getChunks", () => {
    it("returns chunks from local database", async () => {
      mockLocalDb.select.mockResolvedValue([
        {
          id: "chunk-1",
          book_id: "book-1",
          chapter_index: 0,
          chapter_title: "Chapter 1",
          content: "Some text content",
          token_count: 50,
          start_cfi: "epubcfi(/6/2)",
          end_cfi: "epubcfi(/6/4)",
          segment_cfis: null,
          embedding: null,
        },
      ]);

      const chunks = await getChunks("book-1");
      expect(chunks).toHaveLength(1);
      expect(chunks[0].id).toBe("chunk-1");
      expect(chunks[0].bookId).toBe("book-1");
      expect(chunks[0].chapterTitle).toBe("Chapter 1");
      expect(chunks[0].tokenCount).toBe(50);
      expect(coreMocks.getLocalDB).toHaveBeenCalled();
    });

    it("parses segment_cfis JSON", async () => {
      mockLocalDb.select.mockResolvedValue([
        {
          id: "chunk-1",
          book_id: "book-1",
          chapter_index: 0,
          chapter_title: "Ch1",
          content: "text",
          token_count: 10,
          start_cfi: null,
          end_cfi: null,
          segment_cfis: '["cfi1","cfi2"]',
          embedding: null,
        },
      ]);

      const chunks = await getChunks("book-1");
      expect(chunks[0].segmentCfis).toEqual(["cfi1", "cfi2"]);
    });

    it("sorts generated chunk ids by numeric order instead of lexicographic order", async () => {
      mockLocalDb.select.mockResolvedValue(
        [10, 2, 1].map((index) => ({
          id: `book-1-0-${index}`,
          book_id: "book-1",
          chapter_index: 0,
          chapter_title: "Chapter 1",
          content: `chunk ${index}`,
          token_count: 2,
          start_cfi: null,
          end_cfi: null,
          segment_cfis: null,
          embedding: null,
        })),
      );

      const chunks = await getChunks("book-1");
      expect(chunks.map((chunk) => chunk.id)).toEqual(["book-1-0-1", "book-1-0-2", "book-1-0-10"]);
    });
  });

  describe("lightweight chunk reads", () => {
    it("does not select or deserialize embedding blobs for metadata reads", async () => {
      mockLocalDb.select.mockResolvedValue([
        {
          id: "book-1-0-0",
          book_id: "book-1",
          chapter_index: 0,
          chapter_title: "Chapter 1",
          content: "text",
          token_count: 1,
          start_cfi: null,
          end_cfi: null,
          segment_cfis: null,
        },
      ]);

      const chunks = await getChunksWithoutEmbeddings("book-1");

      expect(chunks[0].embedding).toBeUndefined();
      expect(coreMocks.deserializeEmbedding).not.toHaveBeenCalled();
      expect(String(mockLocalDb.select.mock.calls[0][0])).not.toMatch(/\bembedding\b/);
    });

    it("scopes chapter context reads in SQL", async () => {
      mockLocalDb.select.mockResolvedValue([]);

      await getChapterChunks("book-1", 7);

      expect(mockLocalDb.select).toHaveBeenCalledWith(
        expect.stringContaining("chapter_index = ?"),
        ["book-1", 7],
      );
    });

    it("caps metadata previews in SQL without selecting full chunk content", async () => {
      mockLocalDb.select.mockResolvedValue([
        {
          id: "book-1-0-0",
          book_id: "book-1",
          chapter_index: 0,
          chapter_title: "Chapter 1",
          preview: "short preview",
          start_cfi: "cfi-1",
          end_cfi: "cfi-2",
        },
      ]);

      const outlines = await getChunkOutlines("book-1");

      expect(outlines[0].preview).toBe("short preview");
      const sql = String(mockLocalDb.select.mock.calls[0][0]);
      expect(sql).toContain("substr(content, 1, 500) AS preview");
      expect(sql).not.toMatch(/,\s*content\s*,/);
    });
  });

  describe("insertChunks", () => {
    it("inserts multiple chunks into local database", async () => {
      mockLocalDb.execute.mockResolvedValue(undefined);

      const chunks: Chunk[] = [
        {
          id: "chunk-1",
          bookId: "book-1",
          chapterIndex: 0,
          chapterTitle: "Chapter 1",
          content: "Text 1",
          tokenCount: 20,
          startCfi: "",
          endCfi: "",
        },
        {
          id: "chunk-2",
          bookId: "book-1",
          chapterIndex: 1,
          chapterTitle: "Chapter 2",
          content: "Text 2",
          tokenCount: 30,
          startCfi: "",
          endCfi: "",
        },
      ];

      await insertChunks(chunks);
      expect(mockLocalDb.execute).toHaveBeenCalledTimes(2);
    });

    it("serializes embedding when present", async () => {
      mockLocalDb.execute.mockResolvedValue(undefined);

      const chunk: Chunk = {
        id: "chunk-1",
        bookId: "book-1",
        chapterIndex: 0,
        chapterTitle: "Ch1",
        content: "text",
        tokenCount: 10,
        startCfi: "",
        endCfi: "",
        embedding: [0.1, 0.2, 0.3],
      };

      await insertChunks([chunk]);
      expect(coreMocks.serializeEmbedding).toHaveBeenCalledWith([0.1, 0.2, 0.3]);
    });
  });

  describe("deleteChunks", () => {
    it("deletes chunks by book_id from local database", async () => {
      mockLocalDb.execute.mockResolvedValue(undefined);

      await deleteChunks("book-1");
      expect(mockLocalDb.execute).toHaveBeenCalledWith("DELETE FROM chunks WHERE book_id = ?", [
        "book-1",
      ]);
    });
  });
});
