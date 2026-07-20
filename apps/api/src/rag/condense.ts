import type { AiClient } from "../ai/providers.js";

export type ConversationTurn = {
  question: string;
  answer: string;
};

/**
 * "what about for remote employees?" only embeds well as a search query when
 * the conversation context is folded in. This builds the rewrite prompt for
 * one cheap LLM call that turns a follow-up into a standalone question.
 */
export function buildCondensePrompt(
  question: string,
  history: ConversationTurn[]
): { system: string; user: string } {
  const transcript = history
    .map((turn) => `User: ${turn.question}\nAssistant: ${turn.answer}`)
    .join("\n\n");

  return {
    system: `You rewrite a follow-up question into a fully standalone question for a document search engine.

Rules:
- Resolve pronouns and references ("that", "it", "what about X") using the conversation.
- Keep the user's intent exactly; never answer the question.
- If the question is already standalone, return it unchanged.
- Return ONLY the rewritten question — no quotes, no explanations.`,
    user: `Conversation:\n${transcript}\n\nFollow-up question:\n${question}\n\nStandalone question:`
  };
}

/** Guard against models returning chatter instead of a query. */
export function sanitizeCondensedQuestion(raw: string, fallback: string): string {
  const firstLine = raw.trim().split("\n")[0].trim();
  const cleaned = firstLine.replace(/^["']|["']$/g, "").trim();
  if (cleaned.length < 3 || cleaned.length > 500) {
    return fallback;
  }
  return cleaned;
}

/**
 * Rewrite a follow-up into a standalone retrieval query. Any failure falls
 * back to the raw question — retrieval quality degrades, access control does
 * not (the RBAC filter applies regardless of what is embedded).
 */
export async function condenseQuestion(
  ai: AiClient,
  question: string,
  history: ConversationTurn[]
): Promise<string> {
  if (history.length === 0) {
    return question;
  }
  try {
    const raw = await ai.answer(buildCondensePrompt(question, history));
    return sanitizeCondensedQuestion(raw, question);
  } catch {
    return question;
  }
}
