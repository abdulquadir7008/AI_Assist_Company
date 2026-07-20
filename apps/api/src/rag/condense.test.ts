import { describe, expect, it } from "vitest";
import type { AiClient } from "../ai/providers.js";
import { buildCondensePrompt, condenseQuestion, sanitizeCondensedQuestion } from "./condense.js";

const history = [
  { question: "What is the severance policy for layoffs?", answer: "4 weeks per year of service [1]." }
];

describe("buildCondensePrompt", () => {
  it("includes the transcript and the follow-up", () => {
    const prompt = buildCondensePrompt("what about for remote employees?", history);
    expect(prompt.user).toContain("What is the severance policy for layoffs?");
    expect(prompt.user).toContain("4 weeks per year of service");
    expect(prompt.user).toContain("what about for remote employees?");
    expect(prompt.system).toContain("standalone");
  });
});

describe("sanitizeCondensedQuestion", () => {
  it("strips quotes and keeps only the first line", () => {
    expect(sanitizeCondensedQuestion('"What is the remote severance policy?"\nExtra chatter', "fb"))
      .toBe("What is the remote severance policy?");
  });

  it("falls back on empty or absurdly long output", () => {
    expect(sanitizeCondensedQuestion("", "fallback")).toBe("fallback");
    expect(sanitizeCondensedQuestion("x".repeat(600), "fallback")).toBe("fallback");
  });
});

function fakeAi(answerText: string, shouldThrow = false): AiClient {
  return {
    embed: async () => [[0]],
    answer: async () => {
      if (shouldThrow) {
        throw new Error("model down");
      }
      return answerText;
    }
  };
}

describe("condenseQuestion", () => {
  it("returns the question unchanged when there is no history", async () => {
    const result = await condenseQuestion(fakeAi("SHOULD NOT BE CALLED"), "fresh question?", []);
    expect(result).toBe("fresh question?");
  });

  it("uses the model rewrite when history exists", async () => {
    const result = await condenseQuestion(
      fakeAi("What is the severance policy for remote employees?"),
      "what about for remote employees?",
      history
    );
    expect(result).toBe("What is the severance policy for remote employees?");
  });

  it("falls back to the raw question when the model call fails", async () => {
    const result = await condenseQuestion(
      fakeAi("", true),
      "what about for remote employees?",
      history
    );
    expect(result).toBe("what about for remote employees?");
  });
});
