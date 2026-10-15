import { describe, expect, it } from "vitest";
import { SYSTEM_OPEN_BOOK_EXTENSIONS, normalizeIncomingBookFile } from "./system-book-file";

describe("system book file normalization", () => {
  it("keeps every format supported by the mobile importer", () => {
    expect(SYSTEM_OPEN_BOOK_EXTENSIONS).toEqual([
      "epub",
      "pdf",
      "mobi",
      "azw",
      "azw3",
      "cbz",
      "cbr",
      "fb2",
      "fbz",
      "txt",
      "umd",
    ]);
  });

  it("extracts and decodes a supported iOS file URL", () => {
    expect(
      normalizeIncomingBookFile({
        uri: "file:///private/var/mobile/Containers/Data/Application/Inbox/My%20Book.epub",
      }),
    ).toEqual({
      uri: "file:///private/var/mobile/Containers/Data/Application/Inbox/My%20Book.epub",
      name: "My Book.epub",
    });
  });

  it("uses Android content-provider display names", () => {
    expect(
      normalizeIncomingBookFile({
        uri: "content://com.google.android.apps.docs.storage/document/opaque-id",
        name: "The Book.azw3",
        mimeType: "application/vnd.amazon.ebook",
      }),
    ).toEqual({
      uri: "content://com.google.android.apps.docs.storage/document/opaque-id",
      name: "The Book.azw3",
    });
  });

  it("infers an extension from MIME type for an opaque content URI", () => {
    expect(
      normalizeIncomingBookFile({
        uri: "content://downloads/public_downloads/42",
        name: "42",
        mimeType: "application/pdf",
      }),
    ).toEqual({
      uri: "content://downloads/public_downloads/42",
      name: "42.pdf",
    });
  });

  it("ignores custom links and unsupported files", () => {
    expect(
      normalizeIncomingBookFile({
        uri: "readany://callback",
        name: "book.epub",
        mimeType: "application/epub+zip",
      }),
    ).toBeNull();
    expect(
      normalizeIncomingBookFile({
        uri: "file:///tmp/archive.zip",
        name: "archive.zip",
        mimeType: "application/zip",
      }),
    ).toBeNull();
  });
});
