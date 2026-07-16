import type { ChunkWithMeta, ExtractedBlock } from "../types.js";

const targetChunkChars = 1800;
const overlapChars = 250;

type BlockSpan = {
  start: number;
  end: number;
  page?: number;
  section?: string;
};

export function chunkBlocks(blocks: ExtractedBlock[]): ChunkWithMeta[] {
  // Normalize whitespace within each block, then concatenate with an offset map
  // so each chunk can be traced back to the blocks (pages/sections) it spans.
  const spans: BlockSpan[] = [];
  let combined = "";

  for (const block of blocks) {
    const normalized = block.text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }
    if (combined) {
      combined += " ";
    }
    spans.push({
      start: combined.length,
      end: combined.length + normalized.length,
      page: block.page,
      section: block.section
    });
    combined += normalized;
  }

  if (!combined) {
    return [];
  }

  const chunks: ChunkWithMeta[] = [];
  let start = 0;

  while (start < combined.length) {
    const idealEnd = Math.min(start + targetChunkChars, combined.length);
    const sentenceEnd = combined.lastIndexOf(". ", idealEnd);
    const end = sentenceEnd > start + targetChunkChars * 0.6 ? sentenceEnd + 1 : idealEnd;
    const content = combined.slice(start, end).trim();

    if (content) {
      chunks.push({ content, ...chunkMetadata(spans, start, end) });
    }

    if (end >= combined.length) {
      break;
    }
    start = Math.max(0, end - overlapChars);
  }

  return chunks;
}

function chunkMetadata(
  spans: BlockSpan[],
  start: number,
  end: number
): Pick<ChunkWithMeta, "section" | "pageStart" | "pageEnd"> {
  let section: string | undefined;
  let pageStart: number | undefined;
  let pageEnd: number | undefined;

  for (const span of spans) {
    if (span.end <= start || span.start >= end) {
      continue;
    }
    // Section comes from the block containing the start of the chunk.
    if (section === undefined && span.section !== undefined && span.start <= start) {
      section = span.section;
    }
    if (span.page !== undefined) {
      pageStart = pageStart === undefined ? span.page : Math.min(pageStart, span.page);
      pageEnd = pageEnd === undefined ? span.page : Math.max(pageEnd, span.page);
    }
  }

  // If the chunk starts mid-document before any sectioned block, fall back to the
  // first overlapping block that has a section.
  if (section === undefined) {
    const sectioned = spans.find(
      (span) => span.section !== undefined && span.end > start && span.start < end
    );
    section = sectioned?.section;
  }

  return { section, pageStart, pageEnd };
}

export function roughTokenCount(text: string) {
  return Math.ceil(text.length / 4);
}
