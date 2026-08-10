import { getChunkOutlines } from "../db/database";
import type { ReadingContext } from "../types/chat";
import { resolveChapterReference } from "./chapter-reference-resolver";
import { getFallbackChaptersForBook } from "./fallback-source-resolver";

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

export async function resolveReadingChapterIndex(options: {
  bookId: string;
  context: ReadingContext;
  indexed: boolean;
  signal?: AbortSignal;
  /** Context-only tools can skip expensive original-file extraction. */
  allowFallbackExtraction?: boolean;
}): Promise<number | undefined> {
  const { bookId, context, indexed, signal, allowFallbackExtraction = true } = options;
  signal?.throwIfAborted();
  if (context.bookId !== bookId) return undefined;
  if (Number.isFinite(context.currentChapter.logicalIndex)) {
    return context.currentChapter.logicalIndex;
  }
  if (!indexed && !allowFallbackExtraction) return undefined;

  const entries = indexed
    ? (() => {
        return getChunkOutlines(bookId).then((chunks) => {
          const chapters = new Map<number, { chapterTitle: string; preview: string }>();
          for (const chunk of chunks) {
            if (!chapters.has(chunk.chapterIndex)) {
              chapters.set(chunk.chapterIndex, {
                chapterTitle: chunk.chapterTitle,
                preview: chunk.preview,
              });
            }
          }
          return [...chapters.entries()].map(([chapterIndex, chapter]) => ({
            chapterIndex,
            ...chapter,
          }));
        });
      })()
    : getFallbackChaptersForBook(bookId, signal).then((result) =>
        "error" in result
          ? []
          : result.chapters.map((chapter) => ({
              chapterIndex: chapter.index,
              chapterTitle: chapter.title,
              preview: chapter.content.slice(0, 500),
            })),
      );

  const candidates = await entries;
  signal?.throwIfAborted();
  if (candidates.length === 0) return undefined;

  const currentTitle = normalizeTitle(context.currentChapter.title);
  if (currentTitle) {
    const exact = candidates.find(
      (candidate) => normalizeTitle(candidate.chapterTitle) === currentTitle,
    );
    if (exact) return exact.chapterIndex;

    const contained = candidates.filter((candidate) => {
      const candidateTitle = normalizeTitle(candidate.chapterTitle);
      return (
        candidateTitle.length >= 3 &&
        (candidateTitle.includes(currentTitle) || currentTitle.includes(candidateTitle))
      );
    });
    if (contained.length === 1) return contained[0].chapterIndex;

    const resolved = resolveChapterReference(context.currentChapter.title, candidates, 2);
    if (resolved.matched) return resolved.chapterIndex;
  }

  return candidates.some((candidate) => candidate.chapterIndex === context.currentChapter.index)
    ? context.currentChapter.index
    : undefined;
}
