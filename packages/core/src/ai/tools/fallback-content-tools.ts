import { estimateTokens } from "../../rag/chunker";
import { compareCfiPosition } from "../../reader/annotation-order";
import { resolveChapterReference } from "../chapter-reference-resolver";
import type { FallbackChapter } from "../fallback-content-service";
import {
  buildFallbackSnippet,
  findFallbackSegmentByTerms,
  getFallbackChaptersForBook,
} from "../fallback-source-resolver";
import { resolveReadingChapterIndex } from "../reading-context-resolver";
import { readingContextService } from "../reading-context-service";
import type { ToolDefinition } from "./tool-types";

const SEARCH_TOKEN_BUDGET = 3600;
const CHAPTER_TOKEN_BUDGET = 3200;
const DEFAULT_TOC_LIMIT = 20;
const MAX_TOC_LIMIT = 60;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeQuery(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function extractSearchTerms(query: string): string[] {
  const tokens = normalize(query)
    .split(/[\s,，。.!?;；:：、]+/)
    .filter(Boolean);
  const terms = new Set(tokens);

  for (const token of tokens) {
    const cjk = token.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu,
    );
    for (const sequence of cjk ?? []) {
      const cleaned = sequence.replace(
        /(?:这本书|這本書|为什么|為什麼|怎么|怎麼|如何|请问|請問|一下|什么|什麼|について|とは|왜|어떻게)/gu,
        "",
      );
      if (cleaned.length >= 2) terms.add(cleaned);
      for (let size = 2; size <= Math.min(4, cleaned.length); size += 1) {
        for (let index = 0; index <= cleaned.length - size; index += 1) {
          terms.add(cleaned.slice(index, index + size));
        }
      }
    }
  }

  return [...terms].filter((term) => term.length > 0);
}

function clampLimit(value: unknown, fallback = DEFAULT_TOC_LIMIT): number {
  return Math.max(1, Math.min(MAX_TOC_LIMIT, Number(value) || fallback));
}

function scoreChapter(chapter: FallbackChapter, terms: string[]): number {
  const haystack = normalize(`${chapter.title}\n${chapter.content}`);
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = haystack.match(new RegExp(escaped, "g"));
    score += matches?.length ?? 0;
  }
  return score;
}

function findSnippet(chapter: FallbackChapter, terms: string[]): string {
  const content = chapter.content.replace(/\s+/g, " ").trim();
  if (!content) return "";

  const lower = content.toLowerCase();
  const index = terms
    .map((term) => lower.indexOf(term))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (index ?? 0) - 320);
  return content.slice(start, start + 900);
}

export function createFallbackTocTool(bookId: string): ToolDefinition {
  return {
    name: "fallbackToc",
    description:
      "Get a compact chapter list from the original file without vectorization. Use query/aroundChapter/offset/limit instead of loading the full table of contents.",
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
      includePreview: {
        type: "boolean",
        description: "Whether to include short previews for returned chapters (default false)",
      },
    },
    execute: async (args, context) => {
      const data = await getFallbackChaptersForBook(bookId, context?.signal);
      if ("error" in data) return data;

      const maxChapterIndex = Number(args._maxChapterIndex);
      const hasChapterBoundary = Number.isInteger(maxChapterIndex) && maxChapterIndex >= 0;
      let chapters = data.chapters
        .filter((chapter) => !hasChapterBoundary || chapter.index <= maxChapterIndex)
        .map((chapter) => ({
          index: chapter.index,
          title: chapter.title,
          content: chapter.content,
        }));
      const availableChapterCount = chapters.length;
      const query = String(args.query || "").trim();
      const aroundChapter =
        typeof args.aroundChapter === "number" ? Number(args.aroundChapter) : undefined;
      const limit = clampLimit(args.limit);
      const includePreview = Boolean(args.includePreview);
      let offset = Math.max(0, Number(args.offset) || 0);

      if (query) {
        const normalized = normalizeQuery(query);
        chapters = chapters.filter((chapter) =>
          normalizeQuery(`${chapter.index + 1}${chapter.title}`).includes(normalized),
        );
        offset = 0;
      } else if (aroundChapter !== undefined && Number.isFinite(aroundChapter)) {
        const half = Math.floor(limit / 2);
        const aroundIndex = chapters.findIndex((chapter) => chapter.index >= aroundChapter);
        offset =
          aroundIndex >= 0 ? Math.max(0, aroundIndex - half) : Math.max(0, chapters.length - limit);
      }

      const pagedChapters = chapters.slice(offset, offset + limit);
      return {
        bookTitle: data.bookTitle,
        chapters: pagedChapters.map((chapter) => ({
          index: chapter.index,
          title: chapter.title,
          ...(includePreview
            ? { preview: chapter.content.replace(/\s+/g, " ").trim().slice(0, 180) }
            : {}),
        })),
        totalChapters: hasChapterBoundary ? availableChapterCount : data.chapters.length,
        matchedChapters: chapters.length,
        returned: pagedChapters.length,
        offset,
        limit,
        hasMore: offset + pagedChapters.length < chapters.length,
        nextOffset:
          offset + pagedChapters.length < chapters.length
            ? offset + pagedChapters.length
            : undefined,
        instruction:
          "This is a compact chapter list. Use resolveChapterReference for user-provided chapter numbers or fuzzy chapter titles.",
      };
    },
  };
}

export function createFallbackResolveChapterReferenceTool(bookId: string): ToolDefinition {
  return {
    name: "resolveChapterReference",
    description:
      "Resolve a user-mentioned chapter number or fuzzy chapter title to the internal chapterIndex. Use before fallbackChapterContext when the user asks about a specific chapter.",
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
      const data = await getFallbackChaptersForBook(bookId, context?.signal);
      if ("error" in data) return data;

      const maxChapterIndex = Number(args._maxChapterIndex);
      const chapters =
        Number.isInteger(maxChapterIndex) && maxChapterIndex >= 0
          ? data.chapters.filter((chapter) => chapter.index <= maxChapterIndex)
          : data.chapters;

      return resolveChapterReference(
        String(args.query || ""),
        chapters.map((chapter) => ({
          chapterIndex: chapter.index,
          chapterTitle: chapter.title,
          preview: chapter.content.slice(0, 500),
        })),
        Number(args.maxCandidates) || 3,
      );
    },
  };
}

export function createFallbackSearchTool(bookId: string): ToolDefinition {
  return {
    name: "fallbackSearch",
    description:
      "Keyword search the original book file without a vector index. Slower and less semantic than RAG, but useful when the book has not been vectorized. Returns a CFI only when the match can be mapped to a concrete reader text segment.",
    parameters: {
      query: { type: "string", description: "Keywords or phrase to search for", required: true },
      topK: { type: "number", description: "Number of chapters/snippets to return (default: 5)" },
    },
    execute: async (args, context) => {
      const data = await getFallbackChaptersForBook(bookId, context?.signal);
      if ("error" in data) return data;

      const query = String(args.query || "").trim();
      const topK = Math.max(1, Math.min(10, Number(args.topK) || 5));
      const terms = extractSearchTerms(query);
      if (terms.length === 0) return { error: "Query is empty" };

      const maxChapterIndex = Number(args._maxChapterIndex);
      const maxCfi = String(args._maxCfi || "").trim();
      const hasChapterBoundary = Number.isInteger(maxChapterIndex) && maxChapterIndex >= 0;
      const searchableChapters = data.chapters.flatMap((chapter) => {
        if (hasChapterBoundary && chapter.index > maxChapterIndex) return [];
        if (!hasChapterBoundary || chapter.index < maxChapterIndex || !maxCfi) return [chapter];
        const segments = (chapter.segments ?? []).filter(
          (segment) => Boolean(segment.cfi) && compareCfiPosition(String(segment.cfi), maxCfi) < 0,
        );
        if (segments.length === 0) return [];
        return [
          { ...chapter, segments, content: segments.map((segment) => segment.text).join("\n\n") },
        ];
      });
      const allRanked = searchableChapters
        .map((chapter) => ({ chapter, score: scoreChapter(chapter, terms) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      const ranked = allRanked.slice(0, topK);

      let totalTokens = 0;
      const results = [];
      for (const { chapter, score } of ranked) {
        const matchedSegment = findFallbackSegmentByTerms(chapter, terms);
        const snippet = matchedSegment
          ? buildFallbackSnippet(matchedSegment.text, terms)
          : findSnippet(chapter, terms);
        const tokens = estimateTokens(snippet);
        if (totalTokens + tokens > SEARCH_TOKEN_BUDGET) break;
        totalTokens += tokens;
        const result: {
          chapterTitle: string;
          chapterIndex: number;
          content: string;
          score: number;
          cfi?: string;
          cfiPrecision?: "segment";
        } = {
          chapterTitle: chapter.title,
          chapterIndex: chapter.index,
          content: snippet,
          score,
        };
        if (matchedSegment?.cfi) {
          result.cfi = matchedSegment.cfi;
          result.cfiPrecision = "segment";
        }
        results.push(result);
      }

      return {
        query,
        results,
        totalResults: allRanked.length,
        returnedResults: results.length,
        totalTokens,
        tokenBudget: SEARCH_TOKEN_BUDGET,
        instruction:
          "These are keyword fallback results from the original file, not semantic vector results. If a result has a non-empty cfi, you may call addCitation with that exact cfi and quotedText. If no cfi is present, cite chapterTitle/chapterIndex in plain text.",
      };
    },
  };
}

export function createFallbackChapterContextTool(bookId: string): ToolDefinition {
  return {
    name: "fallbackChapterContext",
    description:
      "Read a chapter from the original book file without vectorization. Use it after fallbackToc or when the user asks about a known chapter.",
    parameters: {
      chapterIndex: {
        type: "number",
        description: "Chapter index from fallbackToc",
        required: true,
      },
      cfi: {
        type: "string",
        description:
          "Optional reader CFI to center the returned segments around. For the current page, pass currentCfi from getSurroundingContext.",
      },
      range: {
        type: "number",
        description: "Number of source segments before and after the CFI anchor (default: 8)",
      },
    },
    execute: async (args, context) => {
      const data = await getFallbackChaptersForBook(bookId, context?.signal);
      if ("error" in data) return data;

      const requestedChapterIndex = Number(args.chapterIndex);
      if (!Number.isInteger(requestedChapterIndex) || requestedChapterIndex < 0) {
        return { error: "chapterIndex must be a non-negative integer" };
      }
      const readingContext = readingContextService.getContextForBook(bookId);
      const resolvedCurrentIndex = readingContext
        ? await resolveReadingChapterIndex({
            bookId,
            context: readingContext,
            indexed: false,
            signal: context?.signal,
          })
        : undefined;
      const chapterIndex = requestedChapterIndex;
      const chapter = data.chapters.find((item) => item.index === chapterIndex);
      if (!chapter) return { error: `Chapter ${chapterIndex} not found` };

      const sourceRefs: Array<{
        id: string;
        excerpt: string;
        chapterTitle: string;
        chapterIndex: number;
        cfi?: string;
        cfiPrecision?: "segment";
      }> = [];
      const contentParts: string[] = [];
      const chunks: Array<{
        content: string;
        chapterTitle: string;
        chapterIndex: number;
        cfi?: string;
        cfiPrecision?: "segment";
      }> = [];
      let totalTokens = 0;

      const allSegments = (chapter.segments ?? []).filter((segment) => segment.text?.trim());
      const requestedCfi = String(args.cfi || "").trim();
      const anchorCfi =
        requestedCfi ||
        (resolvedCurrentIndex === chapterIndex ? readingContext?.currentPosition.cfi || "" : "");
      const maxCfi = String(args._maxCfi || "").trim();
      const anchorIndex = anchorCfi
        ? Math.max(
            0,
            allSegments.findIndex((segment, index) => {
              const next = allSegments[index + 1];
              return (
                Boolean(segment.cfi) &&
                compareCfiPosition(segment.cfi, anchorCfi) <= 0 &&
                (!next?.cfi || compareCfiPosition(anchorCfi, next.cfi) < 0)
              );
            }),
          )
        : 0;
      const rawRange = Number(args.range);
      const range = Math.max(0, Math.min(40, Number.isFinite(rawRange) ? rawRange : 8));
      const startSegmentIndex = anchorCfi ? Math.max(0, anchorIndex - range) : 0;
      const endSegmentIndex = anchorCfi
        ? Math.min(allSegments.length, anchorIndex + range + 1)
        : allSegments.length;
      const selectedSegments = allSegments
        .slice(startSegmentIndex, endSegmentIndex)
        .filter(
          (segment) =>
            !maxCfi || (Boolean(segment.cfi) && compareCfiPosition(segment.cfi, maxCfi) < 0),
        );

      for (const segment of selectedSegments) {
        const text = segment.text?.trim();
        if (!text) continue;
        const tokens = estimateTokens(text);
        const shouldTruncateFirstSegment = chunks.length === 0 && tokens > CHAPTER_TOKEN_BUDGET;
        if (!shouldTruncateFirstSegment && totalTokens + tokens > CHAPTER_TOKEN_BUDGET) break;
        const content = shouldTruncateFirstSegment ? text.slice(0, CHAPTER_TOKEN_BUDGET * 4) : text;
        totalTokens += Math.min(tokens, CHAPTER_TOKEN_BUDGET);
        const chunk: {
          content: string;
          chapterTitle: string;
          chapterIndex: number;
          cfi?: string;
          cfiPrecision?: "segment";
        } = {
          content,
          chapterTitle: chapter.title,
          chapterIndex: chapter.index,
        };
        contentParts.push(content);
        if (segment.cfi) {
          chunk.cfi = segment.cfi;
          chunk.cfiPrecision = "segment";
        }
        chunks.push(chunk);
        sourceRefs.push({
          id: `${chapter.index}-${sourceRefs.length}`,
          excerpt: content.slice(0, 180),
          chapterTitle: chapter.title,
          chapterIndex: chapter.index,
          cfi: segment.cfi,
          ...(segment.cfi ? { cfiPrecision: "segment" as const } : {}),
        });
        if (shouldTruncateFirstSegment) break;
      }

      if (chunks.length === 0 && !maxCfi) {
        const tokens = estimateTokens(chapter.content);
        const content =
          tokens > CHAPTER_TOKEN_BUDGET
            ? chapter.content.slice(0, CHAPTER_TOKEN_BUDGET * 4)
            : chapter.content;
        totalTokens = Math.min(tokens, CHAPTER_TOKEN_BUDGET);
        contentParts.push(content);
        sourceRefs.push({
          id: `${chapter.index}-0`,
          excerpt: content.slice(0, 180),
          chapterTitle: chapter.title,
          chapterIndex: chapter.index,
        });
      }

      if (chunks.length === 0 && maxCfi) {
        return {
          error: "No chapter content is available before the protected reading position",
          chapterIndex: chapter.index,
          spoilerProtected: true,
        };
      }

      const content = contentParts.join("\n\n");

      return {
        chapterTitle: chapter.title,
        chapterIndex: chapter.index,
        requestedChapterIndex,
        anchor: {
          cfi: anchorCfi || undefined,
          segmentIndex: anchorCfi ? anchorIndex : undefined,
        },
        content,
        sourceRefs,
        totalTokens,
        tokenBudget: CHAPTER_TOKEN_BUDGET,
        coverage: {
          totalSegments: allSegments.length,
          startSegmentIndex,
          endSegmentIndex: Math.max(startSegmentIndex, startSegmentIndex + chunks.length - 1),
        },
        truncated:
          startSegmentIndex > 0 ||
          startSegmentIndex + chunks.length < allSegments.length ||
          estimateTokens(content) >= CHAPTER_TOKEN_BUDGET,
        instruction:
          "Summarize or analyze this chapter using only the returned content. If the specific chunk you cite has a non-empty cfi, you may call addCitation with that exact cfi and quotedText. If no cfi is present, cite chapterTitle/chapterIndex in plain text.",
      };
    },
  };
}
