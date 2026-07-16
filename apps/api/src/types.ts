export type AiProviderName = "openai" | "huggingface";

/** A structurally meaningful piece of an extracted document (page, heading section, or whole file). */
export type ExtractedBlock = {
  text: string;
  page?: number;
  section?: string;
};

/** A chunk ready for embedding, carrying the source metadata derived from its blocks. */
export type ChunkWithMeta = {
  content: string;
  section?: string;
  pageStart?: number;
  pageEnd?: number;
};

export type RetrievedChunk = {
  chromaId: string;
  /** Postgres DocumentChunk id (from Chroma metadata) — used for audit logs. */
  chunkDbId?: string;
  content: string;
  title: string;
  documentName: string;
  documentId: string;
  category: string;
  fileType?: string;
  section?: string;
  pageStart?: number;
  pageEnd?: number;
  docUpdatedAt?: string;
  distance?: number;
};

/** One numbered source backing part of an answer. `id` matches the inline [n] marker. */
export type AnswerSource = {
  id: number;
  documentId: string;
  chunkId: string;
  document: string;
  section: string | null;
  page: number | null;
  page_end: number | null;
  last_updated: string | null;
  category: string;
};

/** Shape persisted in Question.citations (v2). Older rows are flat Citation arrays. */
export type StoredCitations = {
  version: 2;
  grounded: boolean;
  sources: AnswerSource[];
  retrieved: AnswerSource[];
};
