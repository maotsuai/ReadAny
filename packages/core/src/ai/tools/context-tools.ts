/**
 * Context Tools
 *
 * Tools for accessing user's current reading context:
 * - getCurrentChapter: Get current chapter info
 * - getSelection: Get user's selected text
 * - getReadingProgress: Get reading progress
 * - getRecentHighlights: Get recent highlights
 */
import { getBook, getHighlights, getReadingSessions } from "../../db/database";
import { resolveReadingChapterIndex } from "../reading-context-resolver";
import { readingContextService } from "../reading-context-service";
import type { ToolDefinition } from "./tool-types";

function getBookContext(bookId: string) {
  return readingContextService.getContextForBook(bookId);
}

function toProgress(fraction: number) {
  const normalized = Math.max(0, Math.min(1, Number(fraction) || 0));
  return {
    fraction: normalized,
    percentage: Math.round(normalized * 10_000) / 100,
  };
}

export function createGetCurrentChapterTool(bookId: string): ToolDefinition {
  return {
    name: "getCurrentChapter",
    description:
      "Get information about the user's current reading chapter, including title, position, and progress. Use this when the user's question relates to their current location in the book.",
    parameters: {},
    execute: async (_args, toolContext) => {
      toolContext?.signal?.throwIfAborted();
      const context = getBookContext(bookId);
      const book = await getBook(bookId);

      if (!context) {
        return {
          error: "No reading context available",
          hint: "The user may not be actively reading a book",
        };
      }

      const logicalChapterIndex = await resolveReadingChapterIndex({
        bookId,
        context,
        indexed: book?.isVectorized ?? false,
        signal: toolContext?.signal,
        allowFallbackExtraction: false,
      });
      if (
        logicalChapterIndex !== undefined &&
        context.currentChapter.logicalIndex !== logicalChapterIndex
      ) {
        readingContextService.updateChapter({ logicalIndex: logicalChapterIndex }, bookId);
      }
      return {
        bookId,
        bookTitle: book?.meta?.title || context.bookTitle,
        chapter: {
          title: context.currentChapter.title,
          href: context.currentChapter.href,
          index: logicalChapterIndex ?? context.currentChapter.index,
          spineIndex: context.currentChapter.index,
          logicalIndex: logicalChapterIndex,
        },
        position: {
          cfi: context.currentPosition.cfi,
          page: context.currentPosition.page,
          ...toProgress(context.currentPosition.percentage),
        },
        operationType: context.operationType,
        selectionActive: Boolean(context.selection?.text?.trim()),
        progress: {
          ...toProgress(context.currentPosition.percentage),
          page: context.currentPosition.page,
        },
        timestamp: context.timestamp,
      };
    },
  };
}

export function createGetSelectionTool(bookId: string): ToolDefinition {
  return {
    name: "getSelection",
    description:
      "Get the text currently selected by the user in the reader. Use this when the user asks about specific text they've highlighted or selected.",
    parameters: {},
    execute: async (_args, toolContext) => {
      toolContext?.signal?.throwIfAborted();
      const context = getBookContext(bookId);

      if (!context) {
        return {
          error: "No reading context available",
        };
      }

      if (!context.selection) {
        return {
          error: "No text selected",
          hint: "The user has not selected any text in the reader",
          currentChapter: context.currentChapter.title,
        };
      }

      const book = await getBook(bookId);
      const selectionContext = {
        ...context,
        currentChapter: {
          ...context.currentChapter,
          index: context.selection.chapterIndex,
          title: context.selection.chapterTitle || context.currentChapter.title,
          logicalIndex: undefined,
        },
      };
      const logicalChapterIndex = await resolveReadingChapterIndex({
        bookId,
        context: selectionContext,
        indexed: book?.isVectorized ?? false,
        signal: toolContext?.signal,
        allowFallbackExtraction: false,
      });

      return {
        bookId,
        selectedText: context.selection.text,
        chapterTitle: context.selection.chapterTitle,
        chapterIndex: logicalChapterIndex ?? context.selection.chapterIndex,
        spineIndex: context.selection.chapterIndex,
        logicalChapterIndex,
        cfi: context.selection.cfi,
        surroundingContext: context.surroundingText,
      };
    },
  };
}

export function createGetReadingProgressTool(bookId: string): ToolDefinition {
  return {
    name: "getReadingProgress",
    description:
      "Get the user's reading progress for the current book, including percentage, time spent, and session info.",
    parameters: {},
    execute: async () => {
      const [book, sessions] = await Promise.all([getBook(bookId), getReadingSessions(bookId)]);
      const context = getBookContext(bookId);

      if (!context && !book) {
        return {
          error: "Book not found",
        };
      }

      const fraction = context?.currentPosition.percentage ?? book?.progress ?? 0;
      const totalReadingTimeMs = sessions.reduce(
        (total, session) => total + session.totalActiveTime,
        0,
      );
      const latestSession = sessions[0];

      return {
        bookId,
        bookTitle: book?.meta?.title || context?.bookTitle || "",
        progress: {
          ...toProgress(fraction),
          currentPage: context?.currentPosition.page,
          currentChapter: context?.currentChapter.title,
          currentSpineIndex: context?.currentChapter.index,
        },
        sessions: {
          count: sessions.length,
          totalReadingTimeMs,
          totalPagesRead: sessions.reduce((total, session) => total + session.pagesRead, 0),
          latest: latestSession
            ? {
                startedAt: latestSession.startedAt,
                endedAt: latestSession.endedAt,
                activeTimeMs: latestSession.totalActiveTime,
                state: latestSession.state,
              }
            : undefined,
        },
        lastActivity: context?.timestamp || book?.lastOpenedAt,
        operationType: context?.operationType,
        selectionActive: Boolean(context?.selection?.text?.trim()),
        liveContextAvailable: Boolean(context),
      };
    },
  };
}

export function createGetRecentHighlightsTool(bookId: string): ToolDefinition {
  return {
    name: "getRecentHighlights",
    description:
      "Get the user's most recently created highlights from the current book. Use this to reference what the user has marked as important.",
    parameters: {
      limit: {
        type: "number",
        description: "Maximum number of highlights to return (default: 10)",
      },
    },
    execute: async (args) => {
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 10));

      const highlights = await getHighlights(bookId);

      if (highlights.length === 0) {
        return {
          message: "No highlights found for this book",
          bookId,
        };
      }

      const sortedHighlights = [...highlights].sort((a, b) => b.createdAt - a.createdAt);
      const recentHighlights = sortedHighlights.slice(0, limit).map((h) => ({
        text: h.text,
        note: h.note,
        chapterTitle: h.chapterTitle,
        color: h.color,
        cfi: h.cfi,
        createdAt: h.createdAt,
      }));

      return {
        total: highlights.length,
        highlights: recentHighlights,
      };
    },
  };
}

export function createGetSurroundingContextTool(bookId: string): ToolDefinition {
  return {
    name: "getSurroundingContext",
    description:
      "Get the text surrounding the user's current reading position. Useful for understanding what the user is currently looking at.",
    parameters: {
      includeSelection: {
        type: "boolean",
        description: "Whether to include selected text if available (default: true)",
      },
    },
    execute: async (args, toolContext) => {
      const includeSelection = (args.includeSelection as boolean) ?? true;
      toolContext?.signal?.throwIfAborted();
      await readingContextService.refreshSurroundingText(bookId);
      toolContext?.signal?.throwIfAborted();
      const context = getBookContext(bookId);

      if (!context) {
        return {
          error: "No reading context available",
        };
      }

      const book = await getBook(bookId);
      const logicalChapterIndex = await resolveReadingChapterIndex({
        bookId,
        context,
        indexed: book?.isVectorized ?? false,
        signal: toolContext?.signal,
        allowFallbackExtraction: false,
      });

      return {
        bookId,
        currentChapter: context.currentChapter.title,
        chapterIndex: logicalChapterIndex ?? context.currentChapter.index,
        currentSpineIndex: context.currentChapter.index,
        logicalChapterIndex,
        currentCfi: context.currentPosition.cfi,
        progress: toProgress(context.currentPosition.percentage),
        currentPage: context.currentPosition.page,
        surroundingText: context.surroundingText,
        surroundingTextUpdatedAt: context.surroundingTextUpdatedAt,
        warning: context.surroundingText
          ? undefined
          : "No visible text could be extracted at the current reader position. Use currentCfi with ragContext or fallbackChapterContext.",
        selection: includeSelection ? context.selection : undefined,
        operationType: context.operationType,
        selectionActive: Boolean(context.selection?.text?.trim()),
      };
    },
  };
}

export function getContextTools(bookId: string): ToolDefinition[] {
  return [
    createGetCurrentChapterTool(bookId),
    createGetSelectionTool(bookId),
    createGetReadingProgressTool(bookId),
    createGetRecentHighlightsTool(bookId),
    createGetSurroundingContextTool(bookId),
  ];
}
