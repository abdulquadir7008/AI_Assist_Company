import type { RetrievedChunk } from "../types.js";

/**
 * Human-readable label for a source, used both in the LLM prompt and as a
 * reference format. Falls back: section -> page range -> chunk ordinal.
 */
export function sourceLabel(chunk: RetrievedChunk, ordinal: number): string {
  const name = chunk.documentName || chunk.title;
  const parts: string[] = [];

  if (chunk.section) {
    parts.push(chunk.section);
  }

  if (chunk.pageStart !== undefined) {
    parts.push(
      chunk.pageEnd !== undefined && chunk.pageEnd !== chunk.pageStart
        ? `pp.${chunk.pageStart}–${chunk.pageEnd}`
        : `p.${chunk.pageStart}`
    );
  }

  if (parts.length === 0) {
    parts.push(`Chunk ${ordinal}`);
  }

  return `${name} — ${parts.join(", ")}`;
}

const systemPrompt = `You are a private company assistant. Answer employee questions ONLY using the numbered sources provided.

Rules:
- Every factual claim in your answer must cite its source with an inline marker like [1] or [2][3], placed immediately after the claim it supports.
- Only cite source numbers that appear in the source list. Never invent sources or citation numbers.
- If the sources do not contain enough information to answer the question, reply exactly: "I don't have enough information in the company documents to answer that." Then suggest which internal team or document owner might help. Do not include any citation markers in that case.
- If the sources only cover part of the question, answer the covered part with citations and explicitly state which part is not covered by the company documents.
- Do not use outside knowledge. Be concise and accurate.`;

export function buildAskPrompt(
  question: string,
  chunks: RetrievedChunk[]
): { system: string; user: string } {
  const sources = chunks
    .map((chunk, index) => `[${index + 1}] ${sourceLabel(chunk, index + 1)}\n${chunk.content}`)
    .join("\n\n");

  const user = `Sources:\n${sources}\n\nQuestion:\n${question}`;

  return { system: systemPrompt, user };
}
