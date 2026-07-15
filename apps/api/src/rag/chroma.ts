import { ChromaClient } from "chromadb";
import { config } from "../config.js";
import type { RetrievedChunk } from "../types.js";

const client = new ChromaClient({ path: config.chromaUrl });

async function collection() {
  return client.getOrCreateCollection({ name: config.chromaCollection });
}

export async function upsertChunks(input: {
  ids: string[];
  embeddings: number[][];
  documents: string[];
  metadatas: Record<string, string | number>[];
}) {
  const target = await collection();
  await target.upsert({
    ids: input.ids,
    embeddings: input.embeddings,
    documents: input.documents,
    metadatas: input.metadatas
  });
}

export async function queryChunks(input: {
  embedding: number[];
  companyId: string;
  limit?: number;
}): Promise<RetrievedChunk[]> {
  const target = await collection();
  const result = await target.query({
    queryEmbeddings: [input.embedding],
    nResults: input.limit ?? 6,
    where: { companyId: input.companyId }
  });

  const ids = result.ids[0] ?? [];
  const documents = result.documents[0] ?? [];
  const metadatas = result.metadatas[0] ?? [];
  const distances = result.distances?.[0] ?? [];

  return ids.map((id, index) => {
    const metadata = metadatas[index] as Record<string, string>;
    return {
      chromaId: id,
      content: documents[index] ?? "",
      title: metadata.title ?? "Untitled document",
      documentId: metadata.documentId ?? "",
      category: metadata.category ?? "OTHER",
      distance: distances[index]
    };
  });
}
