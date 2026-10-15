import bookFileTypeConfig from "../../../book-file-types.json";
import type { IncomingDocumentInfo } from "../../../modules/incoming-document-info";

interface BookFileTypeConfig {
  extension: string;
  mimeTypes: string[];
}

export interface IncomingBookFile {
  uri: string;
  name: string;
}

const BOOK_FILE_TYPES = bookFileTypeConfig.types as BookFileTypeConfig[];

export const SYSTEM_OPEN_BOOK_EXTENSIONS = BOOK_FILE_TYPES.map((type) => type.extension);

const EXTENSION_SET = new Set(SYSTEM_OPEN_BOOK_EXTENSIONS);
const MIME_TYPE_TO_EXTENSION = new Map<string, string>();

for (const type of BOOK_FILE_TYPES) {
  for (const mimeType of type.mimeTypes) {
    if (!MIME_TYPE_TO_EXTENSION.has(mimeType.toLowerCase())) {
      MIME_TYPE_TO_EXTENSION.set(mimeType.toLowerCase(), type.extension);
    }
  }
}

function decodeUriPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getLeafName(value?: string): string {
  if (!value) return "";
  const decoded = decodeUriPart(value).replace(/\\/g, "/");
  return decoded.split("/").filter(Boolean).pop()?.split("?")[0]?.split("#")[0] ?? "";
}

function getExtension(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
}

function replaceOrAppendExtension(name: string, extension: string): string {
  const cleanName = name.trim() || "book";
  const dotIndex = cleanName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? cleanName.slice(0, dotIndex) : cleanName;
  return `${baseName}.${extension}`;
}

function isIncomingDocumentUri(uri: string): boolean {
  const scheme = uri.slice(0, uri.indexOf(":"))?.toLowerCase();
  return scheme === "file" || scheme === "content";
}

export function normalizeIncomingBookFile(info: IncomingDocumentInfo): IncomingBookFile | null {
  if (!isIncomingDocumentUri(info.uri)) return null;

  const uriName = getLeafName(info.uri);
  let name = getLeafName(info.name) || uriName;
  const extension = getExtension(name);

  if (EXTENSION_SET.has(extension)) {
    return { uri: info.uri, name };
  }

  const mimeType = info.mimeType?.split(";")[0]?.trim().toLowerCase();
  const inferredExtension = mimeType ? MIME_TYPE_TO_EXTENSION.get(mimeType) : undefined;
  if (!inferredExtension) return null;

  name = replaceOrAppendExtension(name, inferredExtension);
  return { uri: info.uri, name };
}

export async function resolveIncomingBookFile(uri: string): Promise<IncomingBookFile | null> {
  if (!isIncomingDocumentUri(uri)) return null;
  const { getIncomingDocumentInfo } = await import("../../../modules/incoming-document-info");
  return normalizeIncomingBookFile(await getIncomingDocumentInfo(uri));
}
