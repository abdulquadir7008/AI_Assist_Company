import path from "node:path";
import { prisma } from "@company-rag/database";
import {
  DocumentCategory,
  DocumentChunk,
  DocumentSource,
  DocumentStatus
} from "@company-rag/database";
import type { Acl, Principal } from "../access/policy.js";
import { getAiClient } from "../ai/providers.js";
import { config } from "../config.js";
import type { AiProviderName } from "../types.js";
import { chunkBlocks, roughTokenCount } from "./chunk.js";
import { upsertChunks } from "./chroma.js";
import { extractText } from "./extractText.js";
import { buildChunkMetadata } from "./metadata.js";

export type IngestInput = {
  principal: Principal;
  file: { path: string; originalname: string; mimetype: string; size: number };
  title?: string;
  category: DocumentCategory;
  acl: Acl;
  source: DocumentSource;
  /** Whether the uploader explicitly chose the ACL (sets classifiedAt). */
  explicitlyClassified: boolean;
};

function selectedProvider(provider?: string): AiProviderName {
  return provider === "huggingface" ? "huggingface" : "openai";
}

/**
 * The single ingestion pipeline: create the Document row, extract → chunk →
 * embed → store chunks in Postgres and vectors+ACL metadata in Chroma.
 * Used by both the admin upload and the chat upload. On failure the document
 * is marked FAILED and an error with `documentId` attached is thrown.
 */
export async function ingestDocument(input: IngestInput) {
  const { principal, file, acl } = input;

  const document = await prisma.document.create({
    data: {
      companyId: principal.companyId,
      title: input.title || path.parse(file.originalname).name,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storagePath: file.path,
      category: input.category,
      allowedRoles: acl.allowedRoles,
      allowedDepartments: acl.allowedDepartments,
      ownerId: acl.ownerId ?? null,
      source: input.source,
      classifiedAt: input.explicitlyClassified ? new Date() : null,
      classifiedById: input.explicitlyClassified ? principal.userId : null,
      status: DocumentStatus.PROCESSING
    }
  });

  try {
    const blocks = await extractText(file.path, file.mimetype);
    const chunks = chunkBlocks(blocks);

    if (chunks.length === 0) {
      throw new Error("No extractable text was found in this document.");
    }

    const ai = getAiClient(selectedProvider(config.defaultProvider));
    const embeddings = await ai.embed(chunks.map((chunk) => chunk.content));
    const createdChunks: DocumentChunk[] = await prisma.$transaction(
      chunks.map((chunk, index) =>
        prisma.documentChunk.create({
          data: {
            documentId: document.id,
            companyId: principal.companyId,
            index,
            content: chunk.content,
            tokenCount: roughTokenCount(chunk.content),
            section: chunk.section ?? null,
            pageStart: chunk.pageStart ?? null,
            pageEnd: chunk.pageEnd ?? null,
            chromaId: `${document.id}:${index}`
          }
        })
      )
    );

    await upsertChunks({
      ids: createdChunks.map((chunk) => chunk.chromaId),
      embeddings,
      documents: chunks.map((chunk) => chunk.content),
      metadatas: createdChunks.map((chunk) => buildChunkMetadata(document, chunk, acl))
    });

    return prisma.document.update({
      where: { id: document.id },
      data: { status: DocumentStatus.READY },
      include: { _count: { select: { chunks: true } } }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document ingestion failed.";
    await prisma.document.update({
      where: { id: document.id },
      data: { status: DocumentStatus.FAILED, failureReason: message }
    });
    const failure = new Error(message) as Error & { documentId: string };
    failure.documentId = document.id;
    throw failure;
  }
}
