import { describe, expect, it } from "vitest";

import type { Book } from "../../types";
import {
  addBookToImportDuplicateIndex,
  createImportDuplicateIndex,
  findDuplicateBookByHash,
  findImportDuplicate,
  findLikelyDuplicateBook,
  normalizeImportIdentity,
} from "../import-dedupe";

function createBook(overrides: Partial<Book>): Book {
  return {
    id: overrides.id ?? "book-1",
    filePath: overrides.filePath ?? "books/demo.epub",
    format: overrides.format ?? "epub",
    meta: {
      title: overrides.meta?.title ?? "Demo Book",
      author: overrides.meta?.author ?? "Someone",
      coverUrl: overrides.meta?.coverUrl,
    },
    progress: overrides.progress ?? 0,
    isVectorized: overrides.isVectorized ?? false,
    vectorizeProgress: overrides.vectorizeProgress ?? 0,
    tags: overrides.tags ?? [],
    fileHash: overrides.fileHash,
    syncStatus: overrides.syncStatus ?? "local",
    addedAt: overrides.addedAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    lastOpenedAt: overrides.lastOpenedAt ?? 1,
  };
}

describe("import dedupe helpers", () => {
  it("normalizes filenames and punctuation consistently", () => {
    expect(normalizeImportIdentity("  Demo_Book（Vol.1）.epub  ")).toBe("demo book vol 1");
  });

  it("finds duplicates by file hash", () => {
    const existing = createBook({ fileHash: "abc123" });
    const index = createImportDuplicateIndex([existing]);

    expect(findDuplicateBookByHash(index, "abc123")).toEqual(existing);
    expect(findDuplicateBookByHash(index, "missing")).toBeNull();
  });

  it("finds likely duplicates by book title and filename", () => {
    const existing = createBook({
      meta: { title: "Rubbish Theory", author: "Michael Thompson" },
      filePath: "books/Rubbish Theory.epub",
    });
    const index = createImportDuplicateIndex([existing]);

    expect(findLikelyDuplicateBook(index, { name: "Rubbish-Theory.pdf" })).toEqual(existing);
    expect(findLikelyDuplicateBook(index, { title: "Rubbish Theory" })).toEqual(existing);
    expect(findLikelyDuplicateBook(index, { name: "Another Book.epub" })).toBeNull();
  });

  it("falls back to names when a comparable hash is unavailable", () => {
    const legacyBook = createBook({ fileHash: undefined });
    const index = createImportDuplicateIndex([legacyBook]);

    expect(
      findImportDuplicate(index, {
        fileHash: "newly-computed-hash",
        name: "Demo Book.epub",
      }),
    ).toEqual(legacyBook);
  });

  it("does not collapse different known hashes with the same name", () => {
    const existing = createBook({ fileHash: "old-hash" });
    const index = createImportDuplicateIndex([existing]);

    expect(
      findImportDuplicate(index, {
        fileHash: "new-hash",
        name: "Demo Book.epub",
      }),
    ).toBeNull();
  });

  it("updates both indexes during a multi-file import batch", () => {
    const index = createImportDuplicateIndex([]);
    const imported = createBook({ fileHash: "batch-hash" });

    addBookToImportDuplicateIndex(index, imported, "Original Filename.epub");

    expect(findImportDuplicate(index, { fileHash: "batch-hash" })).toEqual(imported);
    expect(findImportDuplicate(index, { name: "Original-Filename.pdf" })).toEqual(imported);
  });
});
