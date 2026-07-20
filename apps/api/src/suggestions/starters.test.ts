import { Department } from "@company-rag/database";
import { describe, expect, it } from "vitest";
import { normalizeQuestion, pickStarters } from "./starters.js";

describe("normalizeQuestion", () => {
  it("groups case/spacing/punctuation variants together", () => {
    expect(normalizeQuestion("What is the PTO policy?")).toBe(
      normalizeQuestion("  what is   the pto POLICY")
    );
  });
});

describe("pickStarters", () => {
  it("every department has at least 4 curated starters", () => {
    for (const department of Object.values(Department)) {
      expect(pickStarters(department, 4)).toHaveLength(4);
    }
  });

  it("respects the requested count", () => {
    expect(pickStarters(Department.HR, 2)).toHaveLength(2);
    expect(pickStarters(Department.HR, 0)).toHaveLength(0);
  });

  it("excludes near-duplicate questions already shown", () => {
    const [first] = pickStarters(Department.SALES, 1);
    const rest = pickStarters(Department.SALES, 4, [first.toUpperCase()]);
    expect(rest).not.toContain(first);
  });
});
