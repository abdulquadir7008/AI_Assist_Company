import { describe, expect, it } from "vitest";
import { buildAskPrompt, sourceLabel } from "./prompt.js";
import type { RetrievedChunk } from "../types.js";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chromaId: "doc1:0",
    content: "Employees may work remotely three days a week.",
    title: "Employee Handbook",
    documentName: "Employee Handbook 2025.pdf",
    documentId: "doc1",
    category: "HR_POLICY",
    ...overrides
  };
}

describe("sourceLabel", () => {
  it("uses section and page when available", () => {
    const label = sourceLabel(chunk({ section: "4.2 Remote Work", pageStart: 12, pageEnd: 12 }), 1);
    expect(label).toBe("Employee Handbook 2025.pdf — 4.2 Remote Work, p.12");
  });

  it("shows a page range when the chunk spans pages", () => {
    const label = sourceLabel(chunk({ pageStart: 12, pageEnd: 13 }), 1);
    expect(label).toBe("Employee Handbook 2025.pdf — pp.12–13");
  });

  it("falls back to page only when there is no section", () => {
    const label = sourceLabel(chunk({ pageStart: 5 }), 2);
    expect(label).toBe("Employee Handbook 2025.pdf — p.5");
  });

  it("falls back to chunk ordinal when there is no section or page", () => {
    const label = sourceLabel(chunk(), 3);
    expect(label).toBe("Employee Handbook 2025.pdf — Chunk 3");
  });

  it("falls back to title when documentName is empty (old chunks)", () => {
    const label = sourceLabel(chunk({ documentName: "" }), 1);
    expect(label).toBe("Employee Handbook — Chunk 1");
  });
});

describe("buildAskPrompt", () => {
  it("enumerates numbered sources with labels and content", () => {
    const prompt = buildAskPrompt("How many remote days do we get?", [
      chunk({ section: "4.2 Remote Work", pageStart: 12 }),
      chunk({ chromaId: "doc2:1", documentName: "PTO Policy.docx", content: "PTO accrues monthly." })
    ]);

    expect(prompt.user).toContain("[1] Employee Handbook 2025.pdf — 4.2 Remote Work, p.12");
    expect(prompt.user).toContain("Employees may work remotely three days a week.");
    expect(prompt.user).toContain("[2] PTO Policy.docx — Chunk 2");
    expect(prompt.user).toContain("PTO accrues monthly.");
    expect(prompt.user).toContain("Question:\nHow many remote days do we get?");
  });

  it("instructs strict grounding and refusal behavior in the system prompt", () => {
    const prompt = buildAskPrompt("q", [chunk()]);
    expect(prompt.system).toContain("ONLY using the numbered sources");
    expect(prompt.system).toContain("Never invent sources");
    expect(prompt.system).toContain(
      "I don't have enough information in the company documents to answer that."
    );
  });
});
