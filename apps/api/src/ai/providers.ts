import OpenAI from "openai";
import { config } from "../config.js";
import type { AiProviderName } from "../types.js";

export type ChatPrompt = {
  system: string;
  user: string;
};

export type AiClient = {
  embed(texts: string[]): Promise<number[][]>;
  answer(prompt: ChatPrompt): Promise<string>;
};

/**
 * Raised when a provider rejects the credentials (bad/missing API key). The
 * HTTP layer turns this into a 401 with a code the web app uses to re-prompt
 * the user for a correct key rather than showing a generic failure.
 */
export type ProviderAuthCode = "PROVIDER_KEY_REQUIRED" | "PROVIDER_KEY_INVALID";

export class ProviderAuthError extends Error {
  constructor(
    public provider: AiProviderName,
    public code: ProviderAuthCode,
    message: string
  ) {
    super(message);
    this.name = "ProviderAuthError";
  }
}

function isAuthStatus(status: unknown): boolean {
  return status === 401 || status === 403;
}

class OpenAiClient implements AiClient {
  private client: OpenAI;
  private hasKey: boolean;

  // apiKey overrides the env key so each user can bring their own (sent per
  // request from the browser and never persisted server-side).
  constructor(apiKey?: string) {
    const key = apiKey || config.openai.apiKey;
    this.hasKey = Boolean(key);
    this.client = new OpenAI({ apiKey: key });
  }

  private requireKey() {
    if (!this.hasKey) {
      throw new ProviderAuthError(
        "openai",
        "PROVIDER_KEY_REQUIRED",
        "An OpenAI API key is required. Add your key to continue."
      );
    }
  }

  async embed(texts: string[]) {
    this.requireKey();
    try {
      const response = await this.client.embeddings.create({
        model: config.openai.embeddingModel,
        input: texts
      });
      return response.data.map((item) => item.embedding);
    } catch (error) {
      throw this.translate(error);
    }
  }

  async answer(prompt: ChatPrompt) {
    this.requireKey();
    try {
      const response = await this.client.chat.completions.create({
        model: config.openai.chatModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ]
      });
      return response.choices[0]?.message.content?.trim() ?? "I do not know.";
    } catch (error) {
      throw this.translate(error);
    }
  }

  // Surface auth failures distinctly so the UI can ask for a valid key.
  private translate(error: unknown): Error {
    const status = (error as { status?: number })?.status;
    if (isAuthStatus(status)) {
      return new ProviderAuthError(
        "openai",
        "PROVIDER_KEY_INVALID",
        "Your OpenAI API key was rejected. Please enter a valid key."
      );
    }
    return error instanceof Error ? error : new Error("OpenAI request failed.");
  }
}

class HuggingFaceClient implements AiClient {
  // The legacy api-inference.huggingface.co endpoint was shut down;
  // all inference now goes through router.huggingface.co.
  private routerUrl = "https://router.huggingface.co";
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || config.huggingFace.apiKey;
  }

  private async post(path: string, body: unknown) {
    if (!this.apiKey) {
      throw new ProviderAuthError(
        "huggingface",
        "PROVIDER_KEY_REQUIRED",
        "A Hugging Face API key is required. Configure HUGGINGFACE_API_KEY."
      );
    }

    const response = await fetch(`${this.routerUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = await response.text();
      if (isAuthStatus(response.status)) {
        throw new ProviderAuthError(
          "huggingface",
          "PROVIDER_KEY_INVALID",
          "The Hugging Face API key was rejected. Please provide a valid key."
        );
      }
      throw new Error(`Hugging Face request failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    return response.json();
  }

  async embed(texts: string[]) {
    const result = await this.post(
      `/hf-inference/models/${config.huggingFace.embeddingModel}/pipeline/feature-extraction`,
      { inputs: texts }
    );

    if (!Array.isArray(result)) {
      throw new Error("Unexpected Hugging Face embedding response.");
    }

    // A single input returns one vector; multiple inputs return one vector per text.
    if (texts.length === 1 && typeof result[0] === "number") {
      return [result as number[]];
    }

    return result as number[][];
  }

  async answer(prompt: ChatPrompt) {
    const result = (await this.post("/v1/chat/completions", {
      model: config.huggingFace.chatModel,
      max_tokens: 600,
      temperature: 0.2,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ]
    })) as { choices?: { message?: { content?: string } }[] };

    return result.choices?.[0]?.message?.content?.trim() || "I do not know.";
  }
}

/**
 * Build a provider client. `apiKey` (optional) overrides the environment key
 * so a user can supply their own OpenAI key per request.
 */
export function getAiClient(provider: AiProviderName, apiKey?: string): AiClient {
  if (provider === "huggingface") {
    return new HuggingFaceClient(apiKey);
  }

  return new OpenAiClient(apiKey);
}

/**
 * Cheap credential check used by the "save key" flow: a tiny embed call that
 * fails fast with ProviderAuthError on a bad key. Returns nothing on success.
 */
export async function validateProviderKey(
  provider: AiProviderName,
  apiKey: string
): Promise<void> {
  const client = getAiClient(provider, apiKey);
  await client.embed(["ping"]);
}
