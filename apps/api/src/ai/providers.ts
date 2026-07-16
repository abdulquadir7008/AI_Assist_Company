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

class OpenAiClient implements AiClient {
  private client = new OpenAI({ apiKey: config.openai.apiKey });

  async embed(texts: string[]) {
    if (!config.openai.apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAI embeddings.");
    }

    const response = await this.client.embeddings.create({
      model: config.openai.embeddingModel,
      input: texts
    });

    return response.data.map((item) => item.embedding);
  }

  async answer(prompt: ChatPrompt) {
    if (!config.openai.apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAI chat.");
    }

    const response = await this.client.chat.completions.create({
      model: config.openai.chatModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ]
    });

    return response.choices[0]?.message.content?.trim() ?? "I do not know.";
  }
}

class HuggingFaceClient implements AiClient {
  // The legacy api-inference.huggingface.co endpoint was shut down;
  // all inference now goes through router.huggingface.co.
  private routerUrl = "https://router.huggingface.co";

  private async post(path: string, body: unknown) {
    const response = await fetch(`${this.routerUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.huggingFace.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Hugging Face request failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    return response.json();
  }

  async embed(texts: string[]) {
    if (!config.huggingFace.apiKey) {
      throw new Error("HUGGINGFACE_API_KEY is required for Hugging Face embeddings.");
    }

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
    if (!config.huggingFace.apiKey) {
      throw new Error("HUGGINGFACE_API_KEY is required for Hugging Face chat.");
    }

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

export function getAiClient(provider: AiProviderName): AiClient {
  if (provider === "huggingface") {
    return new HuggingFaceClient();
  }

  return new OpenAiClient();
}
