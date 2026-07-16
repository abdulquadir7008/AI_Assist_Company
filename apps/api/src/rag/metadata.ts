import type { Acl } from "../access/policy.js";
import { aclToChromaFlags } from "../access/policy.js";
import type { ChunkMetadata } from "./chroma.js";

export type ChunkMetadataDocument = {
  id: string;
  companyId: string;
  title: string;
  originalName: string;
  mimeType: string;
  category: string;
  updatedAt: Date;
};

export type ChunkMetadataChunk = {
  id: string;
  section?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
};

/**
 * The complete Chroma metadata dict for one chunk: citation fields plus the
 * full ACL flag set. Built entirely from Postgres state so reclassification
 * can rewrite it without re-parsing files or re-embedding. Chroma rejects
 * null metadata values, so absent citation fields are omitted; ACL flags are
 * always all present (explicit true/false).
 */
export function buildChunkMetadata(
  document: ChunkMetadataDocument,
  chunk: ChunkMetadataChunk,
  effectiveAcl: Acl
): ChunkMetadata {
  return {
    companyId: document.companyId,
    documentId: document.id,
    chunkId: chunk.id,
    title: document.title,
    category: document.category,
    documentName: document.originalName,
    fileType: document.mimeType,
    docUpdatedAt: document.updatedAt.toISOString(),
    ...(chunk.section != null ? { section: chunk.section } : {}),
    ...(chunk.pageStart != null ? { pageStart: chunk.pageStart } : {}),
    ...(chunk.pageEnd != null ? { pageEnd: chunk.pageEnd } : {}),
    ...aclToChromaFlags(effectiveAcl)
  };
}
