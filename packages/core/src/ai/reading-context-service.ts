/**
 * Reading Context Service
 *
 * Tracks user's current reading state including:
 * - Current chapter and position
 * - Text selection
 * - Recent highlights
 * - Reading progress
 *
 * Provides real-time context for AI tools.
 */
import { useEffect, useState } from "react";
import { getHighlights } from "../db/database";
import { getPlatformService } from "../services/platform";
import type { ReadingContext, SemanticContext } from "../types/chat";

type ReadingContextListener = (context: ReadingContext | null) => void;
type SurroundingTextProvider = () => string | Promise<string>;

const STORE_DIR = "readany-store";
const SNAPSHOT_FILE = "reader-context.json";

class ReadingContextService {
  private context: ReadingContext | null = null;
  private listeners: Set<ReadingContextListener> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotWriteQueue: Promise<void> = Promise.resolve();
  private updateVersion = 0;
  private surroundingTextProviders = new Map<string, SurroundingTextProvider>();
  private initializedDataDir: string | null = null;

  private sanitizeSnapshot(value: unknown): ReadingContext | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<ReadingContext>;
    if (
      typeof record.bookId !== "string" ||
      !record.currentChapter ||
      !record.currentPosition ||
      !Number.isFinite(record.currentChapter.index) ||
      typeof record.currentPosition.cfi !== "string" ||
      !Number.isFinite(record.currentPosition.percentage)
    ) {
      return null;
    }
    const percentage = Math.max(
      0,
      Math.min(
        1,
        record.currentPosition.percentage > 1
          ? record.currentPosition.percentage / 100
          : record.currentPosition.percentage,
      ),
    );
    return {
      bookId: record.bookId,
      bookTitle: typeof record.bookTitle === "string" ? record.bookTitle : "",
      currentChapter: {
        index: record.currentChapter.index,
        logicalIndex: Number.isFinite(record.currentChapter.logicalIndex)
          ? record.currentChapter.logicalIndex
          : undefined,
        title: typeof record.currentChapter.title === "string" ? record.currentChapter.title : "",
        href: typeof record.currentChapter.href === "string" ? record.currentChapter.href : "",
      },
      currentPosition: {
        cfi: record.currentPosition.cfi,
        percentage,
        page: Number.isFinite(record.currentPosition.page)
          ? record.currentPosition.page
          : undefined,
      },
      // Visible text, selections, and highlight bodies are transient and are
      // refreshed from the live reader/DB instead of being written to disk.
      surroundingText: "",
      recentHighlights: [],
      operationType: "reading",
      timestamp: Number.isFinite(record.timestamp) ? Number(record.timestamp) : Date.now(),
    };
  }

  async initialize(): Promise<void> {
    const platform = getPlatformService();
    const dataDir = await platform.getDataDir();
    if (this.initializedDataDir === dataDir) return;
    this.initializedDataDir = dataDir;
    const version = this.updateVersion;
    const dir = await platform.joinPath(dataDir, STORE_DIR);
    const filePath = await platform.joinPath(dir, SNAPSHOT_FILE);
    if (!(await platform.exists(filePath))) return;

    try {
      const parsed = JSON.parse(await platform.readTextFile(filePath));
      const restored = this.sanitizeSnapshot(parsed);
      if (!restored) throw new Error("Invalid reading context snapshot");
      if (version !== this.updateVersion) return;
      this.context = restored;
      this.notify();
      // Migrate older snapshots that contained selected/visible book content.
      await platform.writeTextFile(filePath, JSON.stringify(restored));
    } catch (error) {
      console.warn("[ReadingContext] Failed to restore context snapshot:", error);
      try {
        await platform.deleteFile(filePath);
      } catch {
        // Ignore cleanup failure; a future live reader update will replace it.
      }
    }
  }

  subscribe(listener: ReadingContextListener): () => void {
    this.listeners.add(listener);
    listener(this.context);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener(this.context);
  }

  private debouncedNotify() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.notify();
      this.debounceTimer = null;
    }, 50);
  }

  private scheduleSnapshotWrite(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.enqueueSnapshotWrite();
    }, 150);
  }

  private enqueueSnapshotWrite(): void {
    const snapshot = this.context;
    this.snapshotWriteQueue = this.snapshotWriteQueue.then(
      () => this.writeSnapshot(snapshot),
      () => this.writeSnapshot(snapshot),
    );
  }

  async flushSnapshot(): Promise<void> {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
      this.enqueueSnapshotWrite();
    }
    await this.snapshotWriteQueue;
  }

  private async writeSnapshot(snapshot: ReadingContext | null): Promise<void> {
    try {
      const platform = getPlatformService();
      const dataDir = await platform.getDataDir();
      const dir = await platform.joinPath(dataDir, STORE_DIR);
      await platform.mkdir(dir);
      const filePath = await platform.joinPath(dir, SNAPSHOT_FILE);
      if (!snapshot) {
        if (await platform.exists(filePath)) {
          await platform.deleteFile(filePath);
        }
        return;
      }
      const sanitized = this.sanitizeSnapshot(snapshot);
      if (!sanitized) return;
      await platform.writeTextFile(filePath, JSON.stringify(sanitized));
    } catch (error) {
      console.warn("[ReadingContext] Failed to persist context snapshot:", error);
    }
  }

  getContext(): ReadingContext | null {
    return this.context;
  }

  getContextForBook(bookId: string): ReadingContext | null {
    return this.context?.bookId === bookId ? this.context : null;
  }

  registerSurroundingTextProvider(bookId: string, provider: SurroundingTextProvider): () => void {
    this.surroundingTextProviders.set(bookId, provider);
    return () => {
      if (this.surroundingTextProviders.get(bookId) === provider) {
        this.surroundingTextProviders.delete(bookId);
      }
    };
  }

  async refreshSurroundingText(bookId: string): Promise<string> {
    const context = this.getContextForBook(bookId);
    if (!context) return "";

    const provider = this.surroundingTextProviders.get(bookId);
    if (!provider) return context.surroundingText;

    const expectedPosition = {
      cfi: context.currentPosition.cfi,
      page: context.currentPosition.page,
      percentage: context.currentPosition.percentage,
      chapterIndex: context.currentChapter.index,
    };
    try {
      const rawText = await provider();
      const text = String(rawText || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 4000);
      const latest = this.getContextForBook(bookId);
      if (
        !latest ||
        latest.currentPosition.cfi !== expectedPosition.cfi ||
        latest.currentPosition.page !== expectedPosition.page ||
        latest.currentPosition.percentage !== expectedPosition.percentage ||
        latest.currentChapter.index !== expectedPosition.chapterIndex
      ) {
        return latest?.surroundingText || "";
      }

      this.context = {
        ...latest,
        surroundingText: text,
        surroundingTextUpdatedAt: text ? Date.now() : undefined,
      };
      this.debouncedNotify();
      this.scheduleSnapshotWrite();
      return text;
    } catch (error) {
      console.warn("[ReadingContext] Failed to refresh visible text:", error);
      return this.getContextForBook(bookId)?.surroundingText || "";
    }
  }

  async refreshRecentHighlights(bookId: string): Promise<void> {
    const context = this.getContextForBook(bookId);
    if (!context) return;
    try {
      const highlights = await getHighlights(bookId);
      const latest = this.getContextForBook(bookId);
      if (!latest) return;
      this.context = {
        ...latest,
        recentHighlights: [...highlights]
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 5)
          .map((highlight) => ({
            text: highlight.text,
            cfi: highlight.cfi,
            note: highlight.note,
          })),
      };
      this.debouncedNotify();
      this.scheduleSnapshotWrite();
    } catch (error) {
      console.warn("[ReadingContext] Failed to refresh recent highlights:", error);
    }
  }

  async updateContext(partial: Partial<ReadingContext>): Promise<void> {
    const version = ++this.updateVersion;
    if (!partial.bookId) {
      this.context = null;
      this.notify();
      this.scheduleSnapshotWrite();
      return;
    }

    const now = Date.now();

    if (!this.context || this.context.bookId !== partial.bookId) {
      let highlights: Awaited<ReturnType<typeof getHighlights>> = [];
      try {
        highlights = await getHighlights(partial.bookId);
      } catch (error) {
        console.warn("[ReadingContext] Failed to load recent highlights:", error);
      }
      if (version !== this.updateVersion) return;
      const recentHighlights = [...highlights]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map((h) => ({
          text: h.text,
          cfi: h.cfi,
          note: h.note,
        }));

      const position = partial.currentPosition || { cfi: "", percentage: 0 };
      const normalizedPercentage = Math.max(
        0,
        Math.min(1, position.percentage > 1 ? position.percentage / 100 : position.percentage),
      );

      this.context = {
        bookId: partial.bookId,
        bookTitle: partial.bookTitle || "",
        currentChapter: partial.currentChapter || { index: 0, title: "", href: "" },
        currentPosition: { ...position, percentage: normalizedPercentage },
        surroundingText: partial.surroundingText || "",
        surroundingTextUpdatedAt: partial.surroundingText ? now : undefined,
        recentHighlights,
        operationType: partial.operationType || "reading",
        timestamp: now,
      };
    } else {
      const previous = this.context;
      const currentPosition = partial.currentPosition
        ? {
            ...partial.currentPosition,
            percentage: Math.max(
              0,
              Math.min(
                1,
                partial.currentPosition.percentage > 1
                  ? partial.currentPosition.percentage / 100
                  : partial.currentPosition.percentage,
              ),
            ),
          }
        : previous.currentPosition;
      const positionChanged = Boolean(
        (partial.currentChapter &&
          partial.currentChapter.index !== previous.currentChapter.index) ||
          (partial.currentPosition &&
            (currentPosition.cfi !== previous.currentPosition.cfi ||
              currentPosition.page !== previous.currentPosition.page ||
              currentPosition.percentage !== previous.currentPosition.percentage)),
      );
      const hasSurroundingTextUpdate = typeof partial.surroundingText === "string";
      this.context = {
        ...previous,
        ...partial,
        currentPosition,
        ...(hasSurroundingTextUpdate
          ? {
              surroundingText: partial.surroundingText || "",
              surroundingTextUpdatedAt: partial.surroundingText
                ? partial.surroundingTextUpdatedAt || now
                : undefined,
            }
          : positionChanged
            ? { surroundingText: "", surroundingTextUpdatedAt: undefined }
            : {}),
        timestamp: now,
      };
    }

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  updateSelection(selection: ReadingContext["selection"], bookId?: string): void {
    if (!this.context || (bookId && this.context.bookId !== bookId)) return;

    this.context = {
      ...this.context,
      selection: selection
        ? {
            ...selection,
            chapterIndex: Number.isFinite(selection.chapterIndex)
              ? selection.chapterIndex
              : this.context.currentChapter.index,
            chapterTitle: selection.chapterTitle || this.context.currentChapter.title,
          }
        : undefined,
      operationType: selection ? "selecting" : "reading",
      timestamp: Date.now(),
    };

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  clearSelection(bookId?: string): void {
    if (!this.context || (bookId && this.context.bookId !== bookId)) return;

    this.context = {
      ...this.context,
      selection: undefined,
      operationType: "reading",
      timestamp: Date.now(),
    };

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  updatePosition(position: Partial<ReadingContext["currentPosition"]>, bookId?: string): void {
    if (!this.context || (bookId && this.context.bookId !== bookId)) return;

    this.context = {
      ...this.context,
      currentPosition: {
        ...this.context.currentPosition,
        ...position,
      },
      timestamp: Date.now(),
    };

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  updateChapter(chapter: Partial<ReadingContext["currentChapter"]>, bookId?: string): void {
    if (!this.context || (bookId && this.context.bookId !== bookId)) return;

    this.context = {
      ...this.context,
      currentChapter: {
        ...this.context.currentChapter,
        ...chapter,
      },
      timestamp: Date.now(),
    };

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  setOperationType(type: ReadingContext["operationType"], bookId?: string): void {
    if (!this.context || (bookId && this.context.bookId !== bookId)) return;

    this.context = {
      ...this.context,
      operationType: type,
      timestamp: Date.now(),
    };

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  clearContext(bookId?: string): void {
    if (bookId && this.context?.bookId !== bookId) return;
    this.updateVersion += 1;
    this.context = null;
    this.notify();
    this.scheduleSnapshotWrite();
  }
}

export const readingContextService = new ReadingContextService();

export function useReadingContext(): ReadingContext | null {
  const [context, setContext] = useState<ReadingContext | null>(() =>
    readingContextService.getContext(),
  );

  useEffect(() => readingContextService.subscribe(setContext), []);

  return context;
}

export function getReadingContextSnapshot(): ReadingContext | null {
  return readingContextService.getContext();
}

export function getSemanticReadingContext(bookId: string): SemanticContext | null {
  const context = readingContextService.getContextForBook(bookId);
  if (!context) return null;
  const percentage = Math.round(context.currentPosition.percentage * 10_000) / 100;
  return {
    currentChapter: context.currentChapter.title,
    currentPosition: [
      context.currentPosition.page ? `page ${context.currentPosition.page}` : "",
      `${percentage}%`,
      context.currentPosition.cfi,
    ]
      .filter(Boolean)
      .join(" · "),
    surroundingText: context.surroundingText,
    recentHighlights: context.recentHighlights.map((highlight) => highlight.text),
    operationType: context.operationType,
  };
}
