const targetChunkChars = 1800;
const overlapChars = 250;

export function chunkText(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const idealEnd = Math.min(start + targetChunkChars, normalized.length);
    const sentenceEnd = normalized.lastIndexOf(". ", idealEnd);
    const end = sentenceEnd > start + targetChunkChars * 0.6 ? sentenceEnd + 1 : idealEnd;
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) {
      break;
    }
    start = Math.max(0, end - overlapChars);
  }

  return chunks.filter(Boolean);
}

export function roughTokenCount(text: string) {
  return Math.ceil(text.length / 4);
}
