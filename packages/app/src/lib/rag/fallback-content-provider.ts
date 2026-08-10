import { resolveDesktopDataPath } from "@/lib/storage/desktop-library-root";
import { setFallbackContentProvider } from "@readany/core/ai";
import type { Book } from "@readany/core/types";
import { extractBookChapters } from "./book-extractor";

export function registerDesktopFallbackContentProvider(): void {
  setFallbackContentProvider({
    async getChapters(book: Book, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const filePath = await resolveDesktopDataPath(book.filePath);
      signal?.throwIfAborted();
      const chapters = await extractBookChapters(filePath);
      signal?.throwIfAborted();
      return chapters;
    },
  });
}
