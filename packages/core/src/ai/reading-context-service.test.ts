import { constants } from "node:fs";
import { access, mkdir as fsMkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHighlights } from "../db/database";
import { type IPlatformService, setPlatformService } from "../services";
import { readingContextService } from "./reading-context-service";

vi.mock("../db/database", () => ({
  getHighlights: vi.fn(),
}));

const mockedGetHighlights = vi.mocked(getHighlights);

type TestPlatform = IPlatformService & {
  deletedFiles: string[];
};

function createPlatform(root: string): TestPlatform {
  const deletedFiles: string[] = [];
  return {
    deletedFiles,
    platformType: "desktop",
    isDesktop: true,
    isMobile: false,
    async readFile(path) {
      return readFile(path);
    },
    async writeFile(path, data) {
      await writeFile(path, data);
    },
    async writeTextFile(path, content) {
      await writeFile(path, content, "utf8");
    },
    async readTextFile(path) {
      return readFile(path, "utf8");
    },
    async mkdir(path) {
      await fsMkdir(path, { recursive: true });
    },
    async exists(path) {
      try {
        await access(path, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    async deleteFile(path) {
      deletedFiles.push(path);
      await rm(path, { force: true });
    },
    async getAppDataDir() {
      return root;
    },
    async getDataDir() {
      return root;
    },
    async joinPath(...parts) {
      return join(...parts);
    },
    convertFileSrc(path) {
      return path;
    },
    async pickFile() {
      return null;
    },
    async loadDatabase() {
      throw new Error("not used");
    },
    async fetch() {
      throw new Error("not used");
    },
    async createWebSocket() {
      throw new Error("not used");
    },
    async getAppVersion() {
      return "0.0.0-test";
    },
    async kvGetItem() {
      return null;
    },
    async kvSetItem() {},
    async kvRemoveItem() {},
    async kvGetAllKeys() {
      return [];
    },
    async copyToClipboard() {
      throw new Error("not used");
    },
    async shareOrDownloadFile() {
      throw new Error("not used");
    },
  };
}

describe("readingContextService", () => {
  let root: string;
  let platform: TestPlatform;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "readany-context-"));
    platform = createPlatform(root);
    setPlatformService(platform);
    mockedGetHighlights.mockResolvedValue([
      { text: "Recent note", cfi: "epubcfi(/6/2)", note: "sticky" },
      { text: "Older note", cfi: "epubcfi(/6/4)", note: null },
    ] as any);
    readingContextService.clearContext();
    await readingContextService.flushSnapshot();
  });

  afterEach(async () => {
    readingContextService.clearContext();
    await readingContextService.flushSnapshot();
    await rm(root, { force: true, recursive: true });
    setPlatformService(null as unknown as IPlatformService);
  });

  it("persists the latest context snapshot to disk", async () => {
    await readingContextService.updateContext({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { index: 1, title: "Intro", href: "chapter-1.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
      surroundingText: "hello world",
      operationType: "reading",
    });
    await readingContextService.flushSnapshot();

    const filePath = join(root, "readany-store", "reader-context.json");
    const written = JSON.parse(await readFile(filePath, "utf8"));

    expect(written).toMatchObject({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { title: "Intro" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
      surroundingText: "",
      recentHighlights: [],
      operationType: "reading",
    });
  });

  it("restores a sanitized position snapshot and discards transient book text", async () => {
    const storeDir = join(root, "readany-store");
    await fsMkdir(storeDir, { recursive: true });
    const filePath = join(storeDir, "reader-context.json");
    await writeFile(
      filePath,
      JSON.stringify({
        bookId: "book-restored",
        bookTitle: "Restored",
        currentChapter: { index: 4, title: "Chapter 5", href: "chapter-5.xhtml" },
        currentPosition: { cfi: "epubcfi(/6/10)", percentage: 0.45, page: 9 },
        selection: { text: "private quote", cfi: "secret" },
        surroundingText: "private visible page",
        recentHighlights: [{ text: "private highlight", cfi: "secret" }],
        operationType: "selecting",
        timestamp: 123,
      }),
      "utf8",
    );

    await readingContextService.initialize();

    expect(readingContextService.getContext()).toMatchObject({
      bookId: "book-restored",
      currentChapter: { index: 4, title: "Chapter 5" },
      currentPosition: { cfi: "epubcfi(/6/10)", percentage: 0.45, page: 9 },
      surroundingText: "",
      recentHighlights: [],
      operationType: "reading",
    });
    expect(readingContextService.getContext()?.selection).toBeUndefined();
    expect(JSON.parse(await readFile(filePath, "utf8")).surroundingText).toBe("");
  });

  it("notifies subscribers with current and updated context", async () => {
    const received: Array<string | null> = [];

    const unsubscribe = readingContextService.subscribe((context) => {
      received.push(context?.bookId ?? null);
    });

    await readingContextService.updateContext({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { index: 1, title: "Intro", href: "chapter-1.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
    });

    await new Promise((resolve) => setTimeout(resolve, 70));
    unsubscribe();

    await readingContextService.updateContext({
      bookId: "book-2",
      bookTitle: "Book Two",
      currentChapter: { index: 1, title: "Intro", href: "chapter-1.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
    });

    await new Promise((resolve) => setTimeout(resolve, 70));

    expect(received).toEqual([null, "book-1"]);
  });

  it("removes the snapshot when the context is cleared", async () => {
    await readingContextService.updateContext({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { index: 1, title: "Intro", href: "chapter-1.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
    });
    await readingContextService.flushSnapshot();

    readingContextService.clearContext();
    await readingContextService.flushSnapshot();

    const filePath = join(root, "readany-store", "reader-context.json");
    expect(readingContextService.getContext()).toBeNull();
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not delete a missing snapshot during an empty clear", async () => {
    platform.deletedFiles.length = 0;

    readingContextService.clearContext();
    await readingContextService.flushSnapshot();

    expect(platform.deletedFiles).toEqual([]);
  });

  it("keeps the latest snapshot after rapid updates", async () => {
    mockedGetHighlights.mockResolvedValue([
      { text: "Initial", cfi: "epubcfi(/6/2)", note: null },
    ] as any);

    await readingContextService.updateContext({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { index: 1, title: "Intro", href: "chapter-1.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
      surroundingText: "first",
      operationType: "reading",
    });

    await readingContextService.updateContext({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { index: 2, title: "Middle", href: "chapter-2.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/4)", percentage: 0.5 },
      surroundingText: "second",
      operationType: "selecting",
    });

    await readingContextService.flushSnapshot();

    const filePath = join(root, "readany-store", "reader-context.json");
    const written = JSON.parse(await readFile(filePath, "utf8"));

    expect(written).toMatchObject({
      currentChapter: { index: 2, title: "Middle" },
      currentPosition: { cfi: "epubcfi(/6/4)", percentage: 0.5 },
      surroundingText: "",
      operationType: "reading",
    });
  });

  it("normalizes legacy 0-100 progress values to a 0-1 fraction", async () => {
    await readingContextService.updateContext({
      bookId: "book-1",
      currentChapter: { index: 0, title: "Intro", href: "intro.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 25 },
    });

    expect(readingContextService.getContextForBook("book-1")?.currentPosition.percentage).toBe(
      0.25,
    );
    expect(readingContextService.getContextForBook("book-2")).toBeNull();
  });

  it("refreshes visible text through the provider registered for the same book", async () => {
    await readingContextService.updateContext({
      bookId: "book-1",
      currentChapter: { index: 0, title: "Intro", href: "intro.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.1 },
    });
    const unregister = readingContextService.registerSurroundingTextProvider(
      "book-1",
      async () => "  current   visible text  ",
    );

    await expect(readingContextService.refreshSurroundingText("book-1")).resolves.toBe(
      "current visible text",
    );
    expect(readingContextService.getContextForBook("book-1")?.surroundingText).toBe(
      "current visible text",
    );
    unregister();
  });

  it("clears stale visible text when the reading position changes", async () => {
    await readingContextService.updateContext({
      bookId: "book-1",
      currentChapter: { index: 0, title: "Intro", href: "intro.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.1, page: 1 },
      surroundingText: "page one",
    });

    await readingContextService.updateContext({
      bookId: "book-1",
      currentChapter: { index: 0, title: "Intro", href: "intro.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/4)", percentage: 0.2, page: 2 },
    });

    expect(readingContextService.getContextForBook("book-1")?.surroundingText).toBe("");
    expect(
      readingContextService.getContextForBook("book-1")?.surroundingTextUpdatedAt,
    ).toBeUndefined();
  });

  it("prevents an older asynchronous initialization from overwriting a newer book", async () => {
    let resolveFirst: ((value: any[]) => void) | undefined;
    let resolveSecond: ((value: any[]) => void) | undefined;
    mockedGetHighlights.mockImplementation(
      (bookId) =>
        new Promise((resolve) => {
          if (bookId === "book-1") resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    );

    const first = readingContextService.updateContext({
      bookId: "book-1",
      currentChapter: { index: 0, title: "Old", href: "old.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.1 },
    });
    const second = readingContextService.updateContext({
      bookId: "book-2",
      currentChapter: { index: 1, title: "New", href: "new.xhtml" },
      currentPosition: { cfi: "epubcfi(/8/2)", percentage: 0.2 },
    });

    resolveSecond?.([]);
    await second;
    resolveFirst?.([]);
    await first;

    expect(readingContextService.getContext()?.bookId).toBe("book-2");
    expect(readingContextService.getContext()?.currentChapter.title).toBe("New");
  });

  it("ignores delayed incremental updates from a different book", async () => {
    await readingContextService.updateContext({
      bookId: "book-2",
      currentChapter: { index: 1, title: "Current", href: "current.xhtml" },
      currentPosition: { cfi: "epubcfi(/8/2)", percentage: 0.2 },
    });

    readingContextService.updateSelection(
      {
        text: "stale selection",
        cfi: "epubcfi(/6/2)",
        chapterIndex: 0,
        chapterTitle: "Old",
      },
      "book-1",
    );
    readingContextService.updateChapter({ logicalIndex: 99 }, "book-1");

    expect(readingContextService.getContextForBook("book-2")?.selection).toBeUndefined();
    expect(
      readingContextService.getContextForBook("book-2")?.currentChapter.logicalIndex,
    ).toBeUndefined();
  });
});
