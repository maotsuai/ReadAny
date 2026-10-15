import type { Book } from "../types";

export interface ImportBooksResult {
  imported: Book[];
  skippedDuplicates: Array<{
    name: string;
    existingBook: Book;
  }>;
  failures: Array<{
    name: string;
    error: string;
  }>;
}

export interface ImportDuplicateIndex {
  byHash: Map<string, Book>;
  byName: Map<string, Book>;
}

function getPathLeaf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() || normalized;
}

export function stripBookExtension(name: string): string {
  return name.trim().replace(/\.(epub|pdf|mobi|azw|azw3|cbz|cbr|fb2|fbz|txt|umd)$/i, "");
}

export function normalizeImportIdentity(value: string): string {
  return stripBookExtension(getPathLeaf(value))
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildBookNameCandidates(book: Book): string[] {
  const candidates = [book.meta.title, getPathLeaf(book.filePath)]
    .filter(Boolean)
    .map((value) => normalizeImportIdentity(value as string))
    .filter(Boolean);

  return [...new Set(candidates)];
}

export function createImportDuplicateIndex(books: Book[]): ImportDuplicateIndex {
  const byHash = new Map<string, Book>();
  const byName = new Map<string, Book>();

  for (const book of books) {
    if (book.fileHash) {
      byHash.set(book.fileHash, book);
    }

    for (const candidate of buildBookNameCandidates(book)) {
      if (!byName.has(candidate)) {
        byName.set(candidate, book);
      }
    }
  }

  return { byHash, byName };
}

export function findDuplicateBookByHash(
  index: ImportDuplicateIndex,
  fileHash?: string,
): Book | null {
  if (!fileHash) return null;
  return index.byHash.get(fileHash) ?? null;
}

export function findLikelyDuplicateBook(
  index: ImportDuplicateIndex,
  candidate: {
    name?: string;
    title?: string;
  },
): Book | null {
  const normalizedCandidates = [candidate.title, candidate.name]
    .filter(Boolean)
    .map((value) => normalizeImportIdentity(value as string))
    .filter(Boolean);

  for (const normalized of normalizedCandidates) {
    const existing = index.byName.get(normalized);
    if (existing) return existing;
  }

  return null;
}

/**
 * Prefer an exact hash match. If either side has no comparable hash, fall
 * back to the normalized filename/title index. Two different known hashes
 * are never treated as duplicates merely because their names match.
 */
export function findImportDuplicate(
  index: ImportDuplicateIndex,
  candidate: {
    fileHash?: string;
    name?: string;
    title?: string;
  },
): Book | null {
  const exactMatch = findDuplicateBookByHash(index, candidate.fileHash);
  if (exactMatch) return exactMatch;

  const likelyMatch = findLikelyDuplicateBook(index, candidate);
  if (!likelyMatch) return null;

  if (candidate.fileHash && likelyMatch.fileHash && candidate.fileHash !== likelyMatch.fileHash) {
    return null;
  }

  return likelyMatch;
}

/** Add a freshly imported book to an in-flight batch's duplicate index. */
export function addBookToImportDuplicateIndex(
  index: ImportDuplicateIndex,
  book: Book,
  sourceName?: string,
): void {
  if (book.fileHash) {
    index.byHash.set(book.fileHash, book);
  }

  const candidates = [...buildBookNameCandidates(book), normalizeImportIdentity(sourceName ?? "")];
  for (const candidate of candidates) {
    if (candidate && !index.byName.has(candidate)) {
      index.byName.set(candidate, book);
    }
  }
}

export function createEmptyImportBooksResult(): ImportBooksResult {
  return {
    imported: [],
    skippedDuplicates: [],
    failures: [],
  };
}
