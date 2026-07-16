import { describe, expect, it } from "vitest";
import { chunkBlocks } from "./chunk.js";
import type { ExtractedBlock } from "../types.js";

function words(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, i) => `${prefix}${i} word.`).join(" ");
}

describe("chunkBlocks", () => {
  it("returns empty for no blocks or whitespace-only blocks", () => {
    expect(chunkBlocks([])).toEqual([]);
    expect(chunkBlocks([{ text: "   \n\t " }])).toEqual([]);
  });

  it("carries section and page metadata from a single block", () => {
    const chunks = chunkBlocks([
      { text: "Remote work is allowed three days a week.", page: 12, section: "4.2 Remote Work" }
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].section).toBe("4.2 Remote Work");
    expect(chunks[0].pageStart).toBe(12);
    expect(chunks[0].pageEnd).toBe(12);
  });

  it("spans page ranges when a chunk crosses page boundaries", () => {
    // Two ~1200-char pages: the first chunk (target 1800 chars) must span both.
    const blocks: ExtractedBlock[] = [
      { text: words(120, "a"), page: 1 },
      { text: words(120, "b"), page: 2 }
    ];

    const chunks = chunkBlocks(blocks);
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[0].pageEnd).toBe(2);
  });

  it("assigns the section of the block containing the chunk start", () => {
    const blocks: ExtractedBlock[] = [
      { text: words(200, "intro"), section: "Introduction" },
      { text: words(200, "policy"), section: "PTO Policy" }
    ];

    const chunks = chunkBlocks(blocks);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].section).toBe("Introduction");
    expect(chunks[chunks.length - 1].section).toBe("PTO Policy");
  });

  it("leaves metadata undefined for sectionless, pageless content", () => {
    const chunks = chunkBlocks([{ text: "Short table-ish content | a | b | c" }]);
    expect(chunks[0].section).toBeUndefined();
    expect(chunks[0].pageStart).toBeUndefined();
    expect(chunks[0].pageEnd).toBeUndefined();
  });

  it("preserves overlapping sliding-window behavior", () => {
    const blocks: ExtractedBlock[] = [{ text: words(600, "w") }];
    const chunks = chunkBlocks(blocks);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(1800 + 1);
    }
    // Consecutive chunks share overlapping text.
    const firstEndFragment = chunks[0].content.slice(-100);
    expect(chunks[1].content).toContain(firstEndFragment.slice(0, 50).trim());
  });
});
