import type { Chunk, VectorIndexProvenance } from "../types";
import { deserializeEmbedding, getDB, getLocalDB, serializeEmbedding } from "./db-core";

function getChunkOrder(chunk: Pick<Chunk, "id" | "bookId" | "chapterIndex">): number {
  const prefix = `${chunk.bookId}-${chunk.chapterIndex}-`;
  const raw = chunk.id.startsWith(prefix)
    ? chunk.id.slice(prefix.length)
    : chunk.id.match(/(\d+)$/)?.[1];
  const order = Number(raw);
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

interface ChunkRow {
  id: string;
  book_id: string;
  chapter_index: number;
  chapter_title: string;
  content: string;
  token_count: number;
  start_cfi: string | null;
  end_cfi: string | null;
  segment_cfis: string | null;
  embedding?: unknown;
}

interface ChunkOutlineRow {
  id: string;
  book_id: string;
  chapter_index: number;
  chapter_title: string;
  preview: string;
  start_cfi: string | null;
  end_cfi: string | null;
}

export interface ChunkOutline {
  id: string;
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  preview: string;
  startCfi: string;
  endCfi: string;
}

function mapChunkRow(row: ChunkRow, includeEmbedding: boolean): Chunk {
  let segmentCfis: string[] | undefined;
  if (row.segment_cfis) {
    try {
      const parsed = JSON.parse(row.segment_cfis);
      if (Array.isArray(parsed)) segmentCfis = parsed.filter((item) => typeof item === "string");
    } catch {
      console.warn(`[Chunks] Ignoring invalid segment_cfis JSON for ${row.id}`);
    }
  }

  return {
    id: row.id,
    bookId: row.book_id,
    chapterIndex: row.chapter_index,
    chapterTitle: row.chapter_title,
    content: row.content,
    tokenCount: row.token_count,
    startCfi: row.start_cfi || "",
    endCfi: row.end_cfi || "",
    segmentCfis,
    ...(includeEmbedding ? { embedding: deserializeEmbedding(row.embedding) } : {}),
  };
}

function sortChunks(chunks: Chunk[]): Chunk[] {
  return chunks.sort(
    (left, right) =>
      left.chapterIndex - right.chapterIndex ||
      getChunkOrder(left) - getChunkOrder(right) ||
      left.id.localeCompare(right.id),
  );
}

async function selectChunks(
  bookId: string,
  options: { includeEmbedding: boolean; chapterIndex?: number },
): Promise<Chunk[]> {
  const database = await getLocalDB();
  const columns = [
    "id",
    "book_id",
    "chapter_index",
    "chapter_title",
    "content",
    "token_count",
    "start_cfi",
    "end_cfi",
    "segment_cfis",
    ...(options.includeEmbedding ? ["embedding"] : []),
  ].join(", ");
  const chapterFilter = options.chapterIndex === undefined ? "" : " AND chapter_index = ?";
  const params: unknown[] = [bookId];
  if (options.chapterIndex !== undefined) params.push(options.chapterIndex);
  const rows = await database.select<ChunkRow>(
    `SELECT ${columns} FROM chunks WHERE book_id = ?${chapterFilter} ORDER BY chapter_index, id`,
    params,
  );
  return sortChunks(rows.map((row) => mapChunkRow(row, options.includeEmbedding)));
}

/** Load all chunks including embeddings. Reserved for vector/BM25 search. */
export async function getChunks(bookId: string): Promise<Chunk[]> {
  return selectChunks(bookId, { includeEmbedding: true });
}

/** Load textual chunk metadata without reading or deserializing embedding blobs. */
export async function getChunksWithoutEmbeddings(bookId: string): Promise<Chunk[]> {
  return selectChunks(bookId, { includeEmbedding: false });
}

/** Load one chapter without embeddings so context/citation tools avoid scanning the whole book. */
export async function getChapterChunks(bookId: string, chapterIndex: number): Promise<Chunk[]> {
  return selectChunks(bookId, { includeEmbedding: false, chapterIndex });
}

/**
 * Load only the fields needed for TOC, chapter resolution, and CFI boundaries.
 * The SQL-side preview cap prevents metadata tools from materializing whole books.
 */
export async function getChunkOutlines(bookId: string): Promise<ChunkOutline[]> {
  const database = await getLocalDB();
  const rows = await database.select<ChunkOutlineRow>(
    `SELECT id, book_id, chapter_index, chapter_title,
            substr(content, 1, 500) AS preview, start_cfi, end_cfi
     FROM chunks
     WHERE book_id = ?
     ORDER BY chapter_index, id`,
    [bookId],
  );
  return rows
    .map((row) => ({
      id: row.id,
      bookId: row.book_id,
      chapterIndex: row.chapter_index,
      chapterTitle: row.chapter_title,
      preview: row.preview || "",
      startCfi: row.start_cfi || "",
      endCfi: row.end_cfi || "",
    }))
    .sort(
      (left, right) =>
        left.chapterIndex - right.chapterIndex ||
        getChunkOrder(left) - getChunkOrder(right) ||
        left.id.localeCompare(right.id),
    );
}

export async function insertChunks(chunks: Chunk[]): Promise<void> {
  const database = await getLocalDB();
  const now = Date.now();
  for (const chunk of chunks) {
    await database.execute(
      "INSERT INTO chunks (id, book_id, chapter_index, chapter_title, content, token_count, start_cfi, end_cfi, segment_cfis, embedding, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        chunk.id,
        chunk.bookId,
        chunk.chapterIndex,
        chunk.chapterTitle,
        chunk.content,
        chunk.tokenCount,
        chunk.startCfi || null,
        chunk.endCfi || null,
        chunk.segmentCfis ? JSON.stringify(chunk.segmentCfis) : null,
        serializeEmbedding(chunk.embedding),
        now,
      ],
    );
  }
}

export async function deleteChunks(bookId: string): Promise<void> {
  const database = await getLocalDB();
  await database.execute("DELETE FROM chunks WHERE book_id = ?", [bookId]);
}

export async function getVectorIndexProvenance(
  bookId: string,
): Promise<VectorIndexProvenance | null> {
  const database = await getLocalDB();
  const rows = await database.select<{
    book_id: string;
    model_kind: "builtin" | "remote";
    model_id: string;
    endpoint: string | null;
    dimensions: number;
    created_at: number;
  }>("SELECT * FROM vector_index_provenance WHERE book_id = ?", [bookId]);
  const row = rows[0];
  if (!row) return null;
  return {
    bookId: row.book_id,
    kind: row.model_kind,
    modelId: row.model_id,
    endpoint: row.endpoint || undefined,
    dimensions: row.dimensions,
    createdAt: row.created_at,
  };
}

export async function setVectorIndexProvenance(provenance: VectorIndexProvenance): Promise<void> {
  const database = await getLocalDB();
  await database.execute(
    `INSERT OR REPLACE INTO vector_index_provenance
      (book_id, model_kind, model_id, endpoint, dimensions, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      provenance.bookId,
      provenance.kind,
      provenance.modelId,
      provenance.endpoint || null,
      provenance.dimensions,
      provenance.createdAt,
    ],
  );
}

export async function deleteVectorIndexProvenance(bookId: string): Promise<void> {
  const database = await getLocalDB();
  await database.execute("DELETE FROM vector_index_provenance WHERE book_id = ?", [bookId]);
}

export async function clearVectorizationFlagsWithoutLocalChunks(): Promise<void> {
  const database = await getDB();
  const localDatabase = await getLocalDB();
  const rows = await localDatabase.select<{ book_id: string }>(
    `SELECT DISTINCT chunks.book_id
     FROM chunks
     INNER JOIN vector_index_provenance ON vector_index_provenance.book_id = chunks.book_id`,
  );
  const bookIds = rows.map((row) => row.book_id).filter((bookId) => !!bookId);

  if (bookIds.length === 0) {
    await database.execute(
      "UPDATE books SET is_vectorized = 0, vectorize_progress = 0 WHERE is_vectorized != 0 OR vectorize_progress != 0",
    );
    return;
  }

  const batchSize = 400;
  const clauses: string[] = [];
  const params: string[] = [];

  for (let index = 0; index < bookIds.length; index += batchSize) {
    const batch = bookIds.slice(index, index + batchSize);
    clauses.push(`id NOT IN (${batch.map(() => "?").join(", ")})`);
    params.push(...batch);
  }

  await database.execute(
    `UPDATE books
     SET is_vectorized = 0, vectorize_progress = 0
     WHERE (is_vectorized != 0 OR vectorize_progress != 0)
       AND ${clauses.join(" AND ")}`,
    params,
  );

  const restoreClauses: string[] = [];
  const restoreParams: string[] = [];

  for (let index = 0; index < bookIds.length; index += batchSize) {
    const batch = bookIds.slice(index, index + batchSize);
    restoreClauses.push(`id IN (${batch.map(() => "?").join(", ")})`);
    restoreParams.push(...batch);
  }

  await database.execute(
    `UPDATE books
     SET is_vectorized = 1, vectorize_progress = 1
     WHERE (is_vectorized = 0 OR vectorize_progress < 1)
       AND (${restoreClauses.join(" OR ")})`,
    restoreParams,
  );
}
