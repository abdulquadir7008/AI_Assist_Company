import { describe, expect, it } from "vitest";
import { composeAskResult, parseCitedIds } from "./citations.js";
import type { RetrievedChunk } from "../types.js";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chromaId: "doc1:0",
    content: "content",
    title: "Employee Handbook",
    documentName: "Employee Handbook 2025.pdf",
    documentId: "doc1",
    category: "HR_POLICY",
    section: "4.2 Remote Work",
    pageStart: 12,
    pageEnd: 12,
    docUpdatedAt: "2025-03-01T00:00:00.000Z",
    ...overrides
  };
}

describe("parseCitedIds", () => {
  it("finds simple markers", () => {
    expect(parseCitedIds("PTO accrues monthly [1]. It does not roll over [2].", 6)).toEqual([1, 2]);
  });

  it("dedupes repeated markers", () => {
    expect(parseCitedIds("Yes [1]. Also [1] and again [1].", 6)).toEqual([1]);
  });

  it("handles adjacent markers like [1][3]", () => {
    expect(parseCitedIds("Both policies agree [1][3].", 6)).toEqual([1, 3]);
  });

  it("drops out-of-range ids", () => {
    expect(parseCitedIds("Claim [9] and [0] and [2].", 6)).toEqual([2]);
  });

  it("accepts the [Source n] drift", () => {
    expect(parseCitedIds("Per the handbook [Source 2].", 6)).toEqual([2]);
  });

  it("returns empty when there are no markers", () => {
    expect(parseCitedIds("I don't have enough information in the company documents.", 6)).toEqual([]);
  });
});

describe("composeAskResult", () => {
  const chunks: RetrievedChunk[] = [
    chunk(),
    chunk({ chromaId: "doc1:4", section: "4.3 Carry-over", pageStart: 14, pageEnd: 15 }),
    chunk({ chromaId: "doc2:0", documentId: "doc2", documentName: "PTO Policy.docx", section: "Accrual Rules", pageStart: undefined, pageEnd: undefined })
  ];

  it("keeps original ids and filters to cited sources", () => {
    const result = composeAskResult("Answer part one [1]. Part two [3].", chunks);

    expect(result.grounded).toBe(true);
    expect(result.sources.map((s) => s.id)).toEqual([1, 3]);
    expect(result.sources[0].chunkId).toBe("doc1:0");
    expect(result.sources[1].document).toBe("PTO Policy.docx");
    expect(result.retrieved).toHaveLength(3);
  });

  it("maps chunk metadata into the source shape with null fallbacks", () => {
    const result = composeAskResult("See [3].", chunks);
    expect(result.sources[0]).toEqual({
      id: 3,
      documentId: "doc2",
      chunkId: "doc2:0",
      document: "PTO Policy.docx",
      section: "Accrual Rules",
      page: null,
      page_end: null,
      last_updated: "2025-03-01T00:00:00.000Z",
      category: "HR_POLICY"
    });
  });

  it("is ungrounded with empty sources when no markers appear", () => {
    const result = composeAskResult(
      "I don't have enough information in the company documents to answer that. Try asking HR.",
      chunks
    );

    expect(result.grounded).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.retrieved).toHaveLength(3);
  });

  it("ignores fabricated out-of-range citations", () => {
    const result = composeAskResult("Made-up claim [7].", chunks);
    expect(result.grounded).toBe(false);
    expect(result.sources).toEqual([]);
  });
});
