import { getBook } from "../../db/database";
import { readingContextService } from "../reading-context-service";
import {
  filterSpoilerToolResult,
  guardSpoilerToolCall,
  resolveSpoilerBoundary,
} from "../spoiler-guard";
import { createAddCitationTool } from "./annotation-tools";
import { createFallbackSearchTool } from "./fallback-content-tools";
import { createRagSearchTool } from "./rag-tools";
import type { ToolDefinition, ToolExecutionContext } from "./tool-types";

function uniqueBookIds(bookIds: string[]) {
  return [...new Set(bookIds.filter(Boolean))];
}

function normalizedScore(rawScore: number, indexed: boolean): number {
  if (!Number.isFinite(rawScore) || rawScore <= 0) return 0;
  if (indexed && rawScore <= 1) return rawScore;
  return indexed ? rawScore / (rawScore + 2) : 1 - Math.exp(-rawScore / 3);
}

function throwIfAborted(context?: ToolExecutionContext): void {
  context?.signal?.throwIfAborted();
}

export function createSearchSelectedBooksTool(
  bookIds: string[],
  options: { spoilerFree?: boolean } = {},
): ToolDefinition {
  const selectedBookIds = uniqueBookIds(bookIds);
  return {
    name: "searchSelectedBooks",
    description:
      "Search only the books explicitly selected in the standalone chat context. Results include bookId/bookTitle and a precise CFI when available.",
    parameters: {
      query: {
        type: "string",
        description: "The content query to search across the selected books",
        required: true,
      },
      topK: {
        type: "number",
        description: "Maximum combined results across all selected books (default 8, max 20)",
      },
    },
    execute: async (args, context) => {
      const query = String(args.query || "").trim();
      if (!query) return { error: "Query is empty" };
      if (selectedBookIds.length === 0) return { error: "No books are selected" };
      throwIfAborted(context);

      const topK = Math.max(1, Math.min(20, Number(args.topK) || 8));
      const perBookLimit = Math.max(2, Math.min(8, Math.ceil(topK / selectedBookIds.length) + 1));
      const buckets: Array<Array<Record<string, unknown>>> = selectedBookIds.map(() => []);
      const failures: Array<{ bookId: string; bookTitle?: string; error: string }> = [];
      let nextIndex = 0;
      let searchedBooks = 0;

      const worker = async () => {
        while (true) {
          throwIfAborted(context);
          const index = nextIndex;
          nextIndex += 1;
          if (index >= selectedBookIds.length) return;
          const bookId = selectedBookIds[index];

          try {
            const book = await getBook(bookId);
            throwIfAborted(context);
            if (!book) {
              failures.push({ bookId, error: "Book not found" });
              continue;
            }

            const tool = book.isVectorized
              ? createRagSearchTool(bookId)
              : createFallbackSearchTool(bookId);
            let toolArgs: Record<string, unknown> = { query, topK: perBookLimit };
            let spoilerBoundary = null;
            if (options.spoilerFree) {
              spoilerBoundary = await resolveSpoilerBoundary({
                bookId,
                book,
                context: readingContextService.getContextForBook(bookId),
                indexed: book.isVectorized,
                signal: context?.signal,
              });
              const guarded = guardSpoilerToolCall(tool.name, toolArgs, spoilerBoundary);
              if ("result" in guarded) {
                failures.push({
                  bookId,
                  bookTitle: book.meta.title,
                  error: String(guarded.result.error || "Spoiler boundary could not be verified"),
                });
                continue;
              }
              toolArgs = guarded.args;
            }

            const rawResult = await tool.execute(toolArgs, context);
            throwIfAborted(context);
            const filtered = options.spoilerFree
              ? filterSpoilerToolResult(tool.name, rawResult, spoilerBoundary)
              : rawResult;
            const raw =
              filtered && typeof filtered === "object" ? (filtered as Record<string, unknown>) : {};
            if (typeof raw.error === "string") {
              failures.push({ bookId, bookTitle: book.meta.title, error: raw.error });
              continue;
            }

            const results = Array.isArray(raw.results) ? raw.results : [];
            buckets[index] = results
              .filter(
                (result): result is Record<string, unknown> =>
                  Boolean(result) && typeof result === "object",
              )
              .map((record) => {
                const rawScore = Number(record.score) || 0;
                return {
                  ...record,
                  bookId,
                  bookTitle: book.meta.title,
                  chapterTitle: String(record.chapterTitle || record.chapter || ""),
                  indexed: book.isVectorized,
                  rawScore,
                  score: Math.round(normalizedScore(rawScore, book.isVectorized) * 1000) / 1000,
                };
              })
              .sort((left, right) => Number(right.score) - Number(left.score));
            searchedBooks += 1;
          } catch (error) {
            if (context?.signal?.aborted) throw error;
            failures.push({
              bookId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      };

      const concurrency = Math.min(3, selectedBookIds.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      // Reserve one slot per matching book before filling remaining slots globally.
      // This keeps comparison questions from losing a lower-scoring book entirely.
      const firstPerBook = buckets
        .flatMap((bucket) => (bucket[0] ? [bucket[0]] : []))
        .sort((left, right) => Number(right.score) - Number(left.score))
        .slice(0, topK);
      const selectedKeys = new Set(
        firstPerBook.map(
          (result) => `${result.bookId}:${result.chapterIndex}:${result.cfi}:${result.content}`,
        ),
      );
      const remaining = buckets
        .flat()
        .filter(
          (result) =>
            !selectedKeys.has(
              `${result.bookId}:${result.chapterIndex}:${result.cfi}:${result.content}`,
            ),
        )
        .sort((left, right) => Number(right.score) - Number(left.score));
      const results = [...firstPerBook, ...remaining]
        .slice(0, topK)
        .sort((left, right) => Number(right.score) - Number(left.score));

      return {
        selectedBookIds,
        attemptedBooks: selectedBookIds.length,
        searchedBooks,
        failedBooks: failures,
        results,
        returnedResults: results.length,
        partial: failures.length > 0,
        instruction:
          "Use bookId, chapterIndex, chapter/chapterTitle, cfi and quoted text from a result when registering addCitation.",
      };
    },
  };
}

export function createSelectedBooksCitationTool(
  bookIds: string[],
  options: { spoilerFree?: boolean } = {},
): ToolDefinition {
  const selectedBookIds = uniqueBookIds(bookIds);
  const base = createAddCitationTool(selectedBookIds[0] || "");
  return {
    ...base,
    parameters: {
      bookId: {
        type: "string",
        description: "The bookId returned by searchSelectedBooks",
        required: true,
      },
      ...base.parameters,
    },
    execute: async (args, context) => {
      const bookId = String(args.bookId || "");
      if (!selectedBookIds.includes(bookId)) {
        return { error: "Citations are limited to the books selected for this chat" };
      }

      let citationArgs = args;
      let spoilerBoundary = null;
      if (options.spoilerFree) {
        const book = await getBook(bookId);
        if (!book) return { error: "Book not found" };
        spoilerBoundary = await resolveSpoilerBoundary({
          bookId,
          book,
          context: readingContextService.getContextForBook(bookId),
          indexed: book.isVectorized,
          signal: context?.signal,
        });
        const guarded = guardSpoilerToolCall("addCitation", args, spoilerBoundary);
        if ("result" in guarded) return guarded.result;
        citationArgs = guarded.args;
      }

      const result = await createAddCitationTool(bookId).execute(citationArgs, context);
      return options.spoilerFree
        ? filterSpoilerToolResult("addCitation", result, spoilerBoundary)
        : result;
    },
  };
}
