import { getPlatformService } from "@readany/core";
import { setFallbackContentProvider } from "@readany/core/ai";
import { File as ExpoFile } from "expo-file-system";
import { useEffect, useRef } from "react";
import { type ExtractorRef, ExtractorWebView } from "./ExtractorWebView";

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

const MIME_TYPES: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.ebook",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook+zip",
  fb2: "application/x-fictionbook+xml",
  fbz: "application/x-zip-compressed-fb2",
  txt: "text/plain",
};

/** App-lifetime original-file extractor used by AI fallback tools. */
export function FallbackContentProvider() {
  const extractorRef = useRef<ExtractorRef>(null);
  const extractionQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setFallbackContentProvider({
      async getChapters(book, signal) {
        const extraction = extractionQueueRef.current.then(async () => {
          signal?.throwIfAborted();
          if (!extractorRef.current) throw new Error("Mobile fallback extractor is not ready");
          const platform = getPlatformService();
          const appData = await platform.getAppDataDir();
          const filePath =
            book.filePath.startsWith("/") ||
            book.filePath.startsWith("file://") ||
            book.filePath.startsWith("asset://") ||
            book.filePath.startsWith("http")
              ? book.filePath
              : await platform.joinPath(appData, book.filePath);
          if (/^https?:\/\//i.test(filePath)) {
            throw new Error("Mobile original-file search requires a local book file");
          }

          const file = new ExpoFile(filePath);
          if (!file.exists) throw new Error("Book file is not available on this device");
          signal?.throwIfAborted();
          const bytes = await platform.readFile(filePath);
          signal?.throwIfAborted();
          const chapters = await extractorRef.current.extractChapters(
            bytesToBase64(bytes),
            MIME_TYPES[String(book.format || "").toLowerCase()] || "application/epub+zip",
          );
          signal?.throwIfAborted();
          return chapters;
        });
        extractionQueueRef.current = extraction.then(
          () => undefined,
          () => undefined,
        );
        return extraction;
      },
    });
    return () => setFallbackContentProvider(null);
  }, []);

  return <ExtractorWebView ref={extractorRef} />;
}
