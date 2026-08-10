import { getChunkOutlines } from "../db/database";
import { compareCfiPosition } from "../reader/annotation-order";
import type { Book, ReadingContext } from "../types";
import { getFallbackChaptersForBook } from "./fallback-source-resolver";
import { resolveReadingChapterIndex } from "./reading-context-resolver";

export interface SpoilerBoundary {
  bookId: string;
  chapterIndex?: number;
  cfi?: string;
}

const ANALYSIS_TOOL_NAMES = new Set([
  "summarize",
  "extractEntities",
  "analyzeArguments",
  "findQuotes",
  "compareSections",
]);
const CONTENT_TOOL_NAMES = new Set([
  ...ANALYSIS_TOOL_NAMES,
  "ragSearch",
  "ragToc",
  "ragContext",
  "resolveChapterReference",
  "fallbackSearch",
  "fallbackToc",
  "fallbackChapterContext",
  "addCitation",
]);

function findChapterByCfi(
  chapters: Array<{ chapterIndex: number; startCfi?: string; endCfi?: string }>,
  cfi: string,
): number | undefined {
  const containing = chapters.find(
    (chapter) =>
      Boolean(chapter.startCfi) &&
      compareCfiPosition(chapter.startCfi, cfi) <= 0 &&
      (!chapter.endCfi || compareCfiPosition(cfi, chapter.endCfi) <= 0),
  );
  if (containing) return containing.chapterIndex;

  let nearest: number | undefined;
  for (const chapter of chapters) {
    if (!chapter.startCfi || compareCfiPosition(chapter.startCfi, cfi) > 0) break;
    nearest = chapter.chapterIndex;
  }
  return nearest;
}

export async function resolveSpoilerBoundary(options: {
  bookId: string;
  book: Book | null;
  context: ReadingContext | null;
  indexed: boolean;
  signal?: AbortSignal;
}): Promise<SpoilerBoundary> {
  const { bookId, book, context, indexed, signal } = options;
  signal?.throwIfAborted();
  const cfi = context?.currentPosition.cfi || book?.currentCfi || undefined;
  if (context) {
    const chapterIndex = await resolveReadingChapterIndex({
      bookId,
      context,
      indexed,
      signal,
    });
    if (chapterIndex !== undefined) return { bookId, chapterIndex, cfi };
  }

  if (!cfi) return { bookId };
  if (indexed) {
    const chunks = await getChunkOutlines(bookId);
    signal?.throwIfAborted();
    return {
      bookId,
      chapterIndex: findChapterByCfi(
        chunks.map((chunk) => ({
          chapterIndex: chunk.chapterIndex,
          startCfi: chunk.startCfi,
          endCfi: chunk.endCfi,
        })),
        cfi,
      ),
      cfi,
    };
  }

  const fallback = await getFallbackChaptersForBook(bookId, signal);
  if ("error" in fallback) return { bookId, cfi };
  const segments = fallback.chapters.flatMap((chapter) =>
    (chapter.segments ?? []).map((segment) => ({
      chapterIndex: chapter.index,
      startCfi: segment.cfi,
    })),
  );
  return { bookId, chapterIndex: findChapterByCfi(segments, cfi), cfi };
}

function blocked(boundary: SpoilerBoundary, reason: string) {
  return {
    error: `Spoiler-free mode blocked this tool call: ${reason}`,
    spoilerProtected: true,
    currentChapterIndex: boundary.chapterIndex,
    currentCfi: boundary.cfi,
  };
}

function numericChapter(value: unknown): number | undefined {
  const chapter = Number(value);
  return Number.isInteger(chapter) && chapter >= 0 ? chapter : undefined;
}

export function guardSpoilerToolCall(
  toolName: string,
  args: Record<string, unknown>,
  boundary: SpoilerBoundary | null,
): { args: Record<string, unknown> } | { result: Record<string, unknown> } {
  if (!boundary || !CONTENT_TOOL_NAMES.has(toolName)) return { args };
  if (boundary.chapterIndex === undefined) {
    return { result: blocked(boundary, "the current reading chapter could not be verified") };
  }

  if (toolName === "ragSearch" || toolName === "fallbackSearch") {
    return {
      args: {
        ...args,
        _maxChapterIndex: boundary.chapterIndex,
        ...(boundary.cfi ? { _maxCfi: boundary.cfi } : {}),
      },
    };
  }

  if (
    toolName === "ragToc" ||
    toolName === "fallbackToc" ||
    toolName === "resolveChapterReference"
  ) {
    return { args: { ...args, _maxChapterIndex: boundary.chapterIndex } };
  }

  if (toolName === "compareSections") {
    const first = numericChapter(args.chapterIndex1);
    const second = numericChapter(args.chapterIndex2);
    if (first === undefined || second === undefined) {
      return { result: blocked(boundary, "both chapter indices must be explicit") };
    }
    if (first >= boundary.chapterIndex || second >= boundary.chapterIndex) {
      return {
        result: blocked(
          boundary,
          "analysis of the current or a future chapter may reveal unread content",
        ),
      };
    }
    return { args };
  }

  if (ANALYSIS_TOOL_NAMES.has(toolName)) {
    if (toolName === "summarize" && String(args.scope || "book") === "book") {
      return { result: blocked(boundary, "whole-book analysis includes unread content") };
    }
    const chapter = numericChapter(args.chapterIndex);
    if (chapter === undefined || chapter >= boundary.chapterIndex) {
      return {
        result: blocked(
          boundary,
          "analysis is only allowed for chapters completed before the current chapter",
        ),
      };
    }
    return { args };
  }

  const chapter = numericChapter(args.chapterIndex);
  if (chapter === undefined) {
    return { result: blocked(boundary, "chapterIndex must be explicit") };
  }
  if (chapter > boundary.chapterIndex) {
    return { result: blocked(boundary, "the requested chapter is beyond reading progress") };
  }
  if (chapter === boundary.chapterIndex) {
    if (!boundary.cfi) {
      return {
        result: blocked(
          boundary,
          "the exact position within the current chapter could not be verified",
        ),
      };
    }
    return { args: { ...args, _maxCfi: boundary.cfi } };
  }
  return { args };
}

function isAllowedResult(result: Record<string, unknown>, boundary: SpoilerBoundary): boolean {
  const chapter = numericChapter(result.chapterIndex);
  if (chapter === undefined || boundary.chapterIndex === undefined) return false;
  if (chapter < boundary.chapterIndex) return true;
  if (chapter > boundary.chapterIndex) return false;
  if (!boundary.cfi) return false;
  const cfi = String(result.cfi || "").trim();
  return Boolean(cfi) && compareCfiPosition(cfi, boundary.cfi) < 0;
}

export function filterSpoilerToolResult(
  toolName: string,
  result: unknown,
  boundary: SpoilerBoundary | null,
): unknown {
  if (
    !boundary ||
    (toolName !== "ragSearch" && toolName !== "fallbackSearch" && toolName !== "addCitation") ||
    !result ||
    typeof result !== "object"
  ) {
    return result;
  }

  const record = result as Record<string, unknown>;
  if (toolName === "addCitation" && record.type === "citation") {
    return isAllowedResult(record, boundary)
      ? result
      : blocked(boundary, "the citation is beyond the verified reading position");
  }
  if (!Array.isArray(record.results)) return result;
  const results = record.results.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && isAllowedResult(item, boundary),
  );
  return {
    ...record,
    results,
    returnedResults: results.length,
    spoilerFiltered: record.results.length - results.length,
    warning:
      results.length === 0
        ? "All matches were beyond the verified reading position and were withheld."
        : undefined,
  };
}
