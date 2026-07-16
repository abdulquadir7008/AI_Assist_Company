import type { AnswerSource, RetrievedChunk } from "../types.js";

/**
 * Extract the set of source ids the model actually cited.
 * Accepts [n] and the [Source n] drift some models produce.
 * Ids outside 1..maxId are discarded (never show fabricated sources).
 */
export function parseCitedIds(answer: string, maxId: number): number[] {
  const pattern = /\[(?:source\s+)?(\d+)\]/gi;
  const ids = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(answer)) !== null) {
    const id = Number(match[1]);
    if (id >= 1 && id <= maxId) {
      ids.add(id);
    }
  }

  return [...ids].sort((a, b) => a - b);
}

export function toAnswerSource(chunk: RetrievedChunk, id: number): AnswerSource {
  return {
    id,
    documentId: chunk.documentId,
    chunkId: chunk.chromaId,
    document: chunk.documentName || chunk.title,
    section: chunk.section ?? null,
    page: chunk.pageStart ?? null,
    page_end: chunk.pageEnd ?? null,
    last_updated: chunk.docUpdatedAt ?? null,
    category: chunk.category
  };
}

/**
 * Filter the retrieved chunks down to the ones the answer cites.
 * Original ids are kept (no renumbering), so [1] and [3] may appear with no [2].
 */
export function composeAskResult(
  answer: string,
  chunks: RetrievedChunk[]
): {
  answer: string;
  sources: AnswerSource[];
  grounded: boolean;
  retrieved: AnswerSource[];
} {
  const retrieved = chunks.map((chunk, index) => toAnswerSource(chunk, index + 1));
  const citedIds = parseCitedIds(answer, chunks.length);
  const sources = retrieved.filter((source) => citedIds.includes(source.id));

  return {
    answer,
    sources,
    grounded: sources.length > 0,
    retrieved
  };
}
