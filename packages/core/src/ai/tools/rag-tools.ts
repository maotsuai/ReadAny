/**
 * RAG Tools — search, table of contents, and context retrieval
 */
import { getChapterChunks, getChunkOutlines, getChunks } from "../../db/database";
import { estimateTokens } from "../../rag/chunker";
import { search } from "../../rag/search";
import { compareCfiPosition } from "../../reader/annotation-order";
import type { SearchQuery } from "../../types";
import { resolveChapterReference } from "../chapter-reference-resolver";
import { getFallbackChaptersForBook } from "../fallback-source-resolver";
import { resolveReadingChapterIndex } from "../reading-context-resolver";
import { readingContextService } from "../reading-context-service";
import type { ToolDefinition } from "./tool-types";

const DEFAULT_TOC_LIMIT = 20;
const MAX_TOC_LIMIT = 60;

function clampLimit(value: unknown, fallback = DEFAULT_TOC_LIMIT): number {
  return Math.max(1, Math.min(MAX_TOC_LIMIT, Number(value) || fallback));
}

function getPreciseChunkCfi(
  chunk: Awaited<ReturnType<typeof getChunks>>[number],
  highlights?: string[],
): string {
  const needles = (highlights ?? [])
    .map((highlight) => highlight.replace(/\s+/g, "").trim())
    .filter(Boolean);
  if (needles.length === 0 || !chunk.segmentCfis?.length) return chunk.startCfi || "";

  const segments = chunk.content.split("\n\n");
  const index = segments.findIndex((segment) => {
    const normalized = segment.replace(/\s+/g, "");
    return needles.some((needle) => normalized.includes(needle));
  });
  return (index >= 0 ? chunk.segmentCfis[index] : undefined) || chunk.startCfi || "";
}

function removeLeadingOverlap(previous: string, current: string): string {
  const previousParts = previous
    .split("\n\n")
    .map((part) => part.trim())
    .filter(Boolean);
  const currentParts = current
    .split("\n\n")
    .map((part) => part.trim())
    .filter(Boolean);
  const maxOverlap = Math.min(previousParts.length, currentParts.length, 12);
  for (let size = maxOverlap; size > 0; size -= 1) {
    const suffix = previousParts.slice(-size).join("\n\n");
    const prefix = currentParts.slice(0, size).join("\n\n");
    if (suffix === prefix) return currentParts.slice(size).join("\n\n");
  }
  return current;
}

function truncateChunkAtCfi(
  chunk: Awaited<ReturnType<typeof getChunks>>[number],
  maxCfi?: string,
): string {
  if (!maxCfi) return chunk.content;
  if (chunk.endCfi && compareCfiPosition(chunk.endCfi, maxCfi) <= 0) return chunk.content;
  if (!chunk.segmentCfis?.length) return "";
  const segments = chunk.content.split("\n\n");
  return segments
    .filter((_, index) => {
      const cfi = chunk.segmentCfis?.[index];
      return Boolean(cfi) && compareCfiPosition(cfi, maxCfi) < 0;
    })
    .join("\n\n");
}

function findAnchorChunkIndex(
  chunks: Awaited<ReturnType<typeof getChunks>>,
  options: { chunkId?: string; cfi?: string },
): number {
  if (options.chunkId) {
    const byId = chunks.findIndex((chunk) => chunk.id === options.chunkId);
    if (byId >= 0) return byId;
  }
  if (!options.cfi) return 0;

  const containing = chunks.findIndex(
    (chunk) =>
      Boolean(chunk.startCfi) &&
      compareCfiPosition(chunk.startCfi, options.cfi) <= 0 &&
      (!chunk.endCfi || compareCfiPosition(options.cfi, chunk.endCfi) <= 0),
  );
  if (containing >= 0) return containing;

  let nearest = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    if (!chunks[index].startCfi || compareCfiPosition(chunks[index].startCfi, options.cfi) > 0) {
      break;
    }
    nearest = index;
  }
  return nearest;
}

function normalizeQuery(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function isGenericSectionTitle(title: string): boolean {
  return /^Section\s+\d+$/i.test(title.trim());
}

function shouldPreferOriginalToc(chapters: Map<number, string>): boolean {
  if (chapters.size === 0) return false;
  const titles = Array.from(chapters.values());
  const genericCount = titles.filter(isGenericSectionTitle).length;
  return genericCount >= Math.max(2, Math.ceil(titles.length * 0.6));
}

function getTocDebugInfo(
  chapters: Map<number, string>,
  fallback?: { attempted: boolean; error?: string; chapterCount?: number; sampleTitles?: string[] },
) {
  const titles = Array.from(chapters.values());
  const genericCount = titles.filter(isGenericSectionTitle).length;
  return {
    vectorChapterCount: chapters.size,
    genericSectionCount: genericCount,
    genericSectionRatio:
      titles.length > 0 ? Math.round((genericCount / titles.length) * 100) / 100 : 0,
    preferOriginalToc: shouldPreferOriginalToc(chapters),
    vectorSampleTitles: titles.slice(0, 8),
    fallback,
  };
}

type TocChapter = { index: number; title: string };

function formatCompactTocResult(options: {
  chapters: TocChapter[];
  totalChapters: number;
  args: Record<string, unknown>;
  source: "vector-index" | "vector-index+original-titles";
  bookTitle?: string;
  debug?: unknown;
  warning?: string;
  instruction?: string;
}) {
  let chapterList = options.chapters;
  const maxChapterIndex = Number(options.args._maxChapterIndex);
  if (Number.isInteger(maxChapterIndex) && maxChapterIndex >= 0) {
    chapterList = chapterList.filter((chapter) => chapter.index <= maxChapterIndex);
  }
  const availableChapterCount = chapterList.length;
  const query = String(options.args.query || "").trim();
  const aroundChapter =
    typeof options.args.aroundChapter === "number" ? Number(options.args.aroundChapter) : undefined;
  const limit = clampLimit(options.args.limit);
  let offset = Math.max(0, Number(options.args.offset) || 0);

  if (query) {
    const normalized = normalizeQuery(query);
    chapterList = chapterList.filter((chapter) =>
      normalizeQuery(`${chapter.index + 1}${chapter.title}`).includes(normalized),
    );
    offset = 0;
  } else if (aroundChapter !== undefined && Number.isFinite(aroundChapter)) {
    const half = Math.floor(limit / 2);
    const aroundIndex = chapterList.findIndex((chapter) => chapter.index >= aroundChapter);
    offset =
      aroundIndex >= 0 ? Math.max(0, aroundIndex - half) : Math.max(0, chapterList.length - limit);
  }

  const pagedChapters = chapterList.slice(offset, offset + limit);
  const nextOffset = offset + pagedChapters.length;
  const originalNumbers = new Map(
    options.chapters.map((chapter, index) => [chapter.index, index + 1]),
  );

  return {
    ...(options.bookTitle ? { bookTitle: options.bookTitle } : {}),
    chapters: pagedChapters.map((chapter) => ({
      index: chapter.index,
      number: originalNumbers.get(chapter.index),
      title: chapter.title,
    })),
    totalChapters: Number.isInteger(maxChapterIndex)
      ? availableChapterCount
      : options.totalChapters,
    matchedChapters: chapterList.length,
    returned: pagedChapters.length,
    offset,
    limit,
    hasMore: nextOffset < chapterList.length,
    nextOffset: nextOffset < chapterList.length ? nextOffset : undefined,
    source: options.source,
    ...(options.debug ? { debug: options.debug } : {}),
    ...(options.warning ? { warning: options.warning } : {}),
    instruction:
      options.instruction ??
      "This is a compact chapter list. Use resolveChapterReference for user-provided chapter numbers or fuzzy chapter titles.",
  };
}

function mergeOriginalTitlesIntoVectorChapters(
  vectorChapters: TocChapter[],
  chunks: Awaited<ReturnType<typeof getChunkOutlines>>,
  fallbackChapters: Array<{
    index: number;
    title: string;
    segments?: Array<{ cfi?: string }>;
  }>,
): { chapters: TocChapter[]; matchedTitles: number } {
  const fallbackAnchors = fallbackChapters
    .map((chapter) => ({
      chapter,
      cfi: chapter.segments?.find((segment) => Boolean(segment.cfi))?.cfi || "",
    }))
    .filter((entry) => entry.cfi)
    .sort((left, right) => compareCfiPosition(left.cfi, right.cfi));
  const firstChunkByChapter = new Map<number, (typeof chunks)[number]>();
  for (const chunk of chunks) {
    if (!firstChunkByChapter.has(chunk.chapterIndex))
      firstChunkByChapter.set(chunk.chapterIndex, chunk);
  }

  let matchedTitles = 0;
  const chapters = vectorChapters.map((chapter) => {
    if (!isGenericSectionTitle(chapter.title)) return chapter;
    const vectorCfi = firstChunkByChapter.get(chapter.index)?.startCfi || "";
    let matched = vectorCfi
      ? fallbackAnchors.find((entry, index) => {
          const next = fallbackAnchors[index + 1];
          return (
            compareCfiPosition(entry.cfi, vectorCfi) <= 0 &&
            (!next || compareCfiPosition(vectorCfi, next.cfi) < 0)
          );
        })?.chapter
      : undefined;
    matched ??= fallbackChapters.find((candidate) => candidate.index === chapter.index);
    if (!matched?.title?.trim()) return chapter;
    matchedTitles += 1;
    return { ...chapter, title: matched.title.trim() };
  });
  return { chapters, matchedTitles };
}

/** Create RAG search tool for a specific book */
export function createRagSearchTool(bookId: string): ToolDefinition {
  const MAX_TOTAL_TOKENS = 4000; // Token budget for all results combined
  const MIN_CONTENT_TOKENS = 100; // Minimum tokens per result

  return {
    name: "ragSearch",
    description:
      "Search book content using semantic or keyword search. Returns results with 'cfi' field for precise location. CRITICAL: When you cite content from search results, you MUST extract and pass the 'cfi' field to addCitation - this enables users to jump to the exact location in the book.",
    parameters: {
      query: {
        type: "string",
        description: "The search query describing what to find",
        required: true,
      },
      mode: {
        type: "string",
        description:
          'Search mode: "hybrid" (recommended), "vector" (semantic), or "bm25" (keyword)',
      },
      topK: { type: "number", description: "Number of results to return (default: 5)" },
    },
    execute: async (args, context) => {
      context?.signal?.throwIfAborted();
      const rawQuery = String(args.query || "").trim();
      if (!rawQuery) return { error: "Query is empty" };
      const requestedMode = String(args.mode || "hybrid");
      const mode = ["hybrid", "vector", "bm25"].includes(requestedMode)
        ? (requestedMode as "hybrid" | "vector" | "bm25")
        : "hybrid";
      const query: SearchQuery = {
        query: rawQuery,
        bookId,
        mode,
        topK: Math.max(1, Math.min(20, Number(args.topK) || 5)),
        threshold: 0.3,
      };

      const results = await search(query);
      context?.signal?.throwIfAborted();

      const maxChapterIndex = Number(args._maxChapterIndex);
      const maxCfi = String(args._maxCfi || "").trim();
      const hasChapterBoundary = Number.isInteger(maxChapterIndex) && maxChapterIndex >= 0;

      // Smart truncation with token budget
      let totalTokens = 0;
      const truncatedResults = [];

      for (const r of results) {
        context?.signal?.throwIfAborted();
        if (hasChapterBoundary && r.chunk.chapterIndex > maxChapterIndex) continue;
        const isBoundaryChapter = hasChapterBoundary && r.chunk.chapterIndex === maxChapterIndex;
        const fullContent =
          isBoundaryChapter && maxCfi ? truncateChunkAtCfi(r.chunk, maxCfi) : r.chunk.content;
        if (!fullContent.trim()) continue;
        const fullTokens = estimateTokens(fullContent);

        // Calculate remaining budget
        const remainingBudget = MAX_TOTAL_TOKENS - totalTokens;

        if (remainingBudget <= MIN_CONTENT_TOKENS) {
          // Budget exhausted, stop adding results
          break;
        }

        let content = fullContent;
        let contentTokens = fullTokens;

        // Truncate if exceeds remaining budget
        if (contentTokens > remainingBudget) {
          // Estimate character limit based on remaining tokens
          const charLimit = remainingBudget * 4; // ~4 chars per token
          content = fullContent.slice(0, charLimit);
          contentTokens = estimateTokens(content);
        }

        totalTokens += contentTokens;
        const returnedHighlights = r.highlights?.filter((highlight) =>
          content.replace(/\s+/g, "").includes(highlight.replace(/\s+/g, "")),
        );
        truncatedResults.push({
          chapter: r.chunk.chapterTitle,
          chapterIndex: r.chunk.chapterIndex,
          content,
          score: Math.round(r.score * 1000) / 1000,
          matchType: r.matchType,
          highlights: returnedHighlights,
          cfi: getPreciseChunkCfi(r.chunk, returnedHighlights),
          truncated: fullTokens > contentTokens,
        });
      }

      return {
        results: truncatedResults,
        totalResults: results.length,
        returnedResults: truncatedResults.length,
        totalTokens,
        tokenBudget: MAX_TOTAL_TOKENS,
      };
    },
  };
}

/** Create RAG TOC tool for a specific book */
export function createRagTocTool(bookId: string): ToolDefinition {
  return {
    name: "ragToc",
    description:
      "Get a compact, limited chapter list. Use query/aroundChapter/offset/limit instead of loading the full table of contents.",
    parameters: {
      query: {
        type: "string",
        description: "Optional chapter title or chapter number text to search for",
      },
      aroundChapter: {
        type: "number",
        description: "Optional chapter index to return nearby chapters around",
      },
      offset: {
        type: "number",
        description: "Pagination offset when browsing the chapter list",
      },
      limit: {
        type: "number",
        description: "Maximum chapters to return (default 20, max 60)",
      },
    },
    execute: async (args, context) => {
      context?.signal?.throwIfAborted();
      // Get unique chapter titles from chunks
      const chunks = await getChunkOutlines(bookId);
      const chapters = new Map<number, string>();
      for (const chunk of chunks) {
        if (!chapters.has(chunk.chapterIndex)) {
          chapters.set(chunk.chapterIndex, chunk.chapterTitle);
        }
      }
      const chapterList = Array.from(chapters.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([index, title]) => ({ index, title }));

      if (shouldPreferOriginalToc(chapters)) {
        const fallback = await getFallbackChaptersForBook(bookId, context?.signal);
        if (!("error" in fallback) && fallback.chapters.length > 0) {
          const merged = mergeOriginalTitlesIntoVectorChapters(
            chapterList,
            chunks,
            fallback.chapters,
          );
          console.log("[ragToc] Mapped original TOC titles onto vector chapter indices", {
            bookId,
            vectorChapters: chapterList.length,
            matchedTitles: merged.matchedTitles,
          });
          return formatCompactTocResult({
            bookTitle: fallback.bookTitle,
            chapters: merged.chapters,
            totalChapters: merged.chapters.length,
            source: "vector-index+original-titles",
            args,
            debug: getTocDebugInfo(chapters, {
              attempted: true,
              chapterCount: fallback.chapters.length,
              sampleTitles: fallback.chapters.slice(0, 8).map((chapter) => chapter.title),
            }),
            instruction:
              "Original-file titles were mapped onto the existing vector chapter indices. Use the returned index with RAG tools; re-vectorize the book to permanently refresh titles.",
          });
        }

        const fallbackError = "error" in fallback ? fallback.error : "Original file TOC was empty";
        console.warn("[ragToc] Failed to rebuild generic section TOC from original book", {
          bookId,
          error: fallbackError,
        });
        return formatCompactTocResult({
          chapters: chapterList,
          totalChapters: chapters.size,
          source: "vector-index",
          args,
          debug: getTocDebugInfo(chapters, {
            attempted: true,
            error: fallbackError,
          }),
          warning:
            "The vector index has mostly generic Section titles, but rebuilding the TOC from the original book failed. See debug.fallback.error.",
        });
      }

      return formatCompactTocResult({
        chapters: chapterList,
        totalChapters: chapters.size,
        source: "vector-index",
        args,
        debug: getTocDebugInfo(chapters, { attempted: false }),
      });
    },
  };
}

export function createResolveChapterReferenceTool(bookId: string): ToolDefinition {
  return {
    name: "resolveChapterReference",
    description:
      "Resolve a user-mentioned chapter number or fuzzy chapter title to the internal chapterIndex. Use before ragContext/summarize when the user asks about a specific chapter.",
    parameters: {
      query: {
        type: "string",
        description: "The user's chapter reference, such as '245章' or a chapter title",
        required: true,
      },
      maxCandidates: {
        type: "number",
        description: "Maximum candidates to return when ambiguous (default 3)",
      },
    },
    execute: async (args, context) => {
      context?.signal?.throwIfAborted();
      const chunks = await getChunkOutlines(bookId);
      context?.signal?.throwIfAborted();
      const maxChapterIndex = Number(args._maxChapterIndex);
      const hasChapterBoundary = Number.isInteger(maxChapterIndex) && maxChapterIndex >= 0;
      const chapters = new Map<number, { title: string; preview: string }>();
      for (const chunk of chunks) {
        if (hasChapterBoundary && chunk.chapterIndex > maxChapterIndex) continue;
        if (!chapters.has(chunk.chapterIndex)) {
          chapters.set(chunk.chapterIndex, {
            title: chunk.chapterTitle,
            preview: chunk.preview,
          });
        }
      }

      const entries = Array.from(chapters.entries()).map(([chapterIndex, chapter]) => ({
        chapterIndex,
        chapterTitle: chapter.title,
        preview: chapter.preview,
      }));

      return resolveChapterReference(
        String(args.query || ""),
        entries,
        Number(args.maxCandidates) || 3,
      );
    },
  };
}

/** Create RAG context tool for a specific book */
export function createRagContextTool(bookId: string): ToolDefinition {
  const MAX_TOTAL_TOKENS = 3000;

  return {
    name: "ragContext",
    description:
      "Get surrounding text context for a specific chapter. Use this when the user asks about content near a specific location. Returns chunks with CFI information - use the CFI from the chunk containing your quoted text when calling addCitation.",
    parameters: {
      chapterIndex: { type: "number", description: "The chapter index", required: true },
      range: {
        type: "number",
        description: "Number of chunks to include before and after (default: 2)",
      },
      cfi: {
        type: "string",
        description:
          "Optional reader CFI to center the context around. For the current page, pass currentCfi from getSurroundingContext/getCurrentChapter.",
      },
      chunkId: {
        type: "string",
        description: "Optional chunk id from a previous result to use as the center anchor",
      },
    },
    execute: async (args, context) => {
      context?.signal?.throwIfAborted();
      const requestedChapterIndex = Number(args.chapterIndex);
      if (!Number.isInteger(requestedChapterIndex) || requestedChapterIndex < 0) {
        return { error: "chapterIndex must be a non-negative integer" };
      }
      const rawRange = Number(args.range);
      const range = Math.max(0, Math.min(8, Number.isFinite(rawRange) ? rawRange : 2));

      const chunks = await getChapterChunks(bookId, requestedChapterIndex);
      context?.signal?.throwIfAborted();
      const readingContext = readingContextService.getContextForBook(bookId);
      const resolvedCurrentIndex = readingContext
        ? await resolveReadingChapterIndex({
            bookId,
            context: readingContext,
            indexed: true,
            signal: context?.signal,
          })
        : undefined;
      const chapterIndex = requestedChapterIndex;
      const chapterChunks = chunks;
      if (chapterChunks.length === 0) {
        return { error: `Chapter ${chapterIndex} not found`, chapterIndex };
      }

      const requestedCfi = String(args.cfi || "").trim();
      const maxCfi = String(args._maxCfi || "").trim();
      const eligibleChapterChunks = maxCfi
        ? chapterChunks.filter(
            (chunk) => Boolean(chunk.startCfi) && compareCfiPosition(chunk.startCfi, maxCfi) <= 0,
          )
        : chapterChunks;
      if (eligibleChapterChunks.length === 0) {
        return {
          error: "No chapter content is available before the protected reading position",
          chapterIndex,
          spoilerProtected: Boolean(maxCfi),
        };
      }
      const anchorCfi =
        requestedCfi ||
        (resolvedCurrentIndex === chapterIndex ? readingContext?.currentPosition.cfi || "" : "");
      const requestedChunkId = String(args.chunkId || "").trim();
      const anchorChunkIndex = findAnchorChunkIndex(eligibleChapterChunks, {
        chunkId: requestedChunkId || undefined,
        cfi: anchorCfi || undefined,
      });
      const matchedChunkId = requestedChunkId
        ? eligibleChapterChunks.some((chunk) => chunk.id === requestedChunkId)
        : true;
      const matchedCfi = anchorCfi
        ? eligibleChapterChunks.some(
            (chunk) =>
              Boolean(chunk.startCfi) &&
              compareCfiPosition(chunk.startCfi, anchorCfi) <= 0 &&
              (!chunk.endCfi || compareCfiPosition(anchorCfi, chunk.endCfi) <= 0),
          )
        : true;
      const anchorMatched = matchedChunkId && matchedCfi;
      const startIndex = Math.max(0, anchorChunkIndex - range);
      const endIndex = Math.min(eligibleChapterChunks.length, anchorChunkIndex + range + 1);
      const windowChunks = eligibleChapterChunks.slice(startIndex, endIndex);

      // Get surrounding chunks with token budget
      const sourceRefs: Array<{ id: string; excerpt: string; cfi: string }> = [];
      const contextParts: string[] = [];
      let totalTokens = 0;

      let previousContent = "";
      for (const c of windowChunks) {
        context?.signal?.throwIfAborted();
        const boundedContent = truncateChunkAtCfi(c, maxCfi || undefined);
        const deduplicatedContent = previousContent
          ? removeLeadingOverlap(previousContent, boundedContent)
          : boundedContent;
        if (!deduplicatedContent) continue;
        previousContent = boundedContent;
        const chunkTokens = estimateTokens(deduplicatedContent);
        if (totalTokens + chunkTokens > MAX_TOTAL_TOKENS) {
          // Truncate to fit budget
          const remaining = MAX_TOTAL_TOKENS - totalTokens;
          if (remaining > 100) {
            const charLimit = remaining * 4;
            const content = deduplicatedContent.slice(0, charLimit);
            contextParts.push(content);
            sourceRefs.push({
              id: c.id,
              excerpt: content.slice(0, 180),
              cfi: c.startCfi || "",
            });
            totalTokens += estimateTokens(content);
          }
          break;
        }
        contextParts.push(deduplicatedContent);
        sourceRefs.push({
          id: c.id,
          excerpt: deduplicatedContent.slice(0, 180),
          cfi: c.startCfi || "",
        });
        totalTokens += chunkTokens;
      }

      if (contextParts.length === 0 && maxCfi) {
        return {
          error: "No chapter content is available before the protected reading position",
          chapterIndex,
          spoilerProtected: true,
        };
      }

      return {
        chapterTitle: chapterChunks[0]?.chapterTitle || "Unknown",
        chapterIndex: chapterIndex,
        requestedChapterIndex,
        anchor: {
          cfi: anchorCfi || undefined,
          chunkId: eligibleChapterChunks[anchorChunkIndex]?.id,
          chunkIndex: anchorChunkIndex,
          matched: anchorMatched,
        },
        ...(!anchorMatched
          ? {
              warning:
                "The requested CFI/chunk anchor was not found exactly; context was centered on the nearest available chunk.",
            }
          : {}),
        context: contextParts.join("\n\n"),
        sourceRefs,
        chunksIncluded: contextParts.length,
        totalTokens,
        tokenBudget: MAX_TOTAL_TOKENS,
      };
    },
  };
}
