import { ChromaClient, type Where } from "chromadb";
import { config } from "../config.js";
import type { RetrievedChunk } from "../types.js";

const client = new ChromaClient({ path: config.chromaUrl });

async function collection() {
  return client.getOrCreateCollection({ name: config.chromaCollection });
}

export type ChunkMetadata = Record<string, string | number | boolean>;

export async function upsertChunks(input: {
  ids: string[];
  embeddings: number[][];
  documents: string[];
  metadatas: ChunkMetadata[];
}) {
  const target = await collection();
  await target.upsert({
    ids: input.ids,
    embeddings: input.embeddings,
    documents: input.documents,
    metadatas: input.metadatas
  });
}

/**
 * Metadata-only rewrite (no re-embedding) — used when a document or chunk is
 * reclassified so the retrieval-layer ACL flags never go stale. Callers must
 * pass the COMPLETE metadata dict per chunk.
 */
export async function updateChunkMetadata(input: {
  ids: string[];
  metadatas: ChunkMetadata[];
}) {
  const target = await collection();
  await target.update({
    ids: input.ids,
    metadatas: input.metadatas
  });
}

/**
 * accessWhere is REQUIRED and must come from buildChromaAccessFilter — the
 * access rule is enforced inside the similarity search itself, so chunks the
 * requester cannot see are never retrieved, scored, or passed to the LLM.
 */
export async function queryChunks(input: {
  embedding: number[];
  accessWhere: Where;
  limit?: number;
}): Promise<RetrievedChunk[]> {
  const target = await collection();
  const result = await target.query({
    queryEmbeddings: [input.embedding],
    nResults: input.limit ?? 6,
    where: input.accessWhere
  });

  const ids = result.ids[0] ?? [];
  const documents = result.documents[0] ?? [];
  const metadatas = result.metadatas[0] ?? [];
  const distances = result.distances?.[0] ?? [];

  return ids.map((id, index) => {
    // Fallbacks keep chunks ingested before citation metadata existed usable.
    const metadata = (metadatas[index] ?? {}) as Record<string, unknown>;
    const title = typeof metadata.title === "string" ? metadata.title : "Untitled document";
    return {
      chromaId: id,
      chunkDbId: typeof metadata.chunkId === "string" ? metadata.chunkId : undefined,
      content: documents[index] ?? "",
      title,
      documentName: typeof metadata.documentName === "string" ? metadata.documentName : title,
      documentId: typeof metadata.documentId === "string" ? metadata.documentId : "",
      category: typeof metadata.category === "string" ? metadata.category : "OTHER",
      fileType: typeof metadata.fileType === "string" ? metadata.fileType : undefined,
      section: typeof metadata.section === "string" ? metadata.section : undefined,
      pageStart: typeof metadata.pageStart === "number" ? metadata.pageStart : undefined,
      pageEnd: typeof metadata.pageEnd === "number" ? metadata.pageEnd : undefined,
      docUpdatedAt: typeof metadata.docUpdatedAt === "string" ? metadata.docUpdatedAt : undefined,
      distance: distances[index]
    };
  });
}
