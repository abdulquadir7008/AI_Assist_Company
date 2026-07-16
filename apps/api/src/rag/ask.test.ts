import { describe, expect, it } from "vitest";
import type { AiClient } from "../ai/providers.js";
import { composeAskResult } from "./citations.js";
import { buildAskPrompt } from "./prompt.js";
import type { RetrievedChunk } from "../types.js";

/**
 * Pipeline test: buildAskPrompt -> (mocked) AiClient.answer -> composeAskResult,
 * mirroring the /ask route composition without Express/Postgres/Chroma.
 */

function mockAi(reply: string): AiClient {
  return {
    embed: async (texts) => texts.map(() => [0, 0, 0]),
    answer: async () => reply
  };
}

const chunks: RetrievedChunk[] = [
  {
    chromaId: "doc1:0",
    content: "Employees accrue 25 days of PTO per year.",
    title: "Employee Handbook",
    documentName: "Employee Handbook 2025.pdf",
    documentId: "doc1",
    category: "HR_POLICY",
    section: "4.2 Paid Leave",
    pageStart: 12,
    pageEnd: 12,
    docUpdatedAt: "2025-01-08T10:22:00.000Z"
  },
  {
    chromaId: "doc1:4",
    content: "Unused PTO does not roll over between years.",
    title: "Employee Handbook",
    documentName: "Employee Handbook 2025.pdf",
    documentId: "doc1",
    category: "HR_POLICY",
    section: "4.3 Carry-over",
    pageStart: 14,
    pageEnd: 15,
    docUpdatedAt: "2025-01-08T10:22:00.000Z"
  }
];

describe("ask pipeline composition", () => {
  it("returns cited sources for a grounded answer", async () => {
    const ai = mockAi("You get 25 days of PTO [1]. Unused days do not roll over [2].");
    const prompt = buildAskPrompt("How much PTO do I get?", chunks);
    const answer = await ai.answer(prompt);
    const result = composeAskResult(answer, chunks);

    expect(result.grounded).toBe(true);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({
      id: 1,
      document: "Employee Handbook 2025.pdf",
      section: "4.2 Paid Leave",
      page: 12,
      last_updated: "2025-01-08T10:22:00.000Z"
    });
  });

  it("returns empty sources and grounded=false for a refusal", async () => {
    const ai = mockAi(
      "I don't have enough information in the company documents to answer that. Try asking the HR team."
    );
    const prompt = buildAskPrompt("What is the CEO's shoe size?", chunks);
    const answer = await ai.answer(prompt);
    const result = composeAskResult(answer, chunks);

    expect(result.grounded).toBe(false);
    expect(result.sources).toEqual([]);
    // Retrieval context is still preserved for auditing.
    expect(result.retrieved).toHaveLength(2);
  });
});
