import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

export const config = {
  apiPort: Number(process.env.API_PORT ?? 4000),
  chromaUrl: process.env.CHROMA_URL ?? "http://localhost:8000",
  chromaCollection: process.env.CHROMA_COLLECTION ?? "company_documents",
  defaultProvider: (process.env.DEFAULT_AI_PROVIDER ?? "openai").toLowerCase(),
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    chatModel: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"
  },
  huggingFace: {
    apiKey: process.env.HUGGINGFACE_API_KEY,
    chatModel: process.env.HUGGINGFACE_CHAT_MODEL ?? "meta-llama/Llama-3.1-8B-Instruct",
    embeddingModel:
      process.env.HUGGINGFACE_EMBEDDING_MODEL ?? "sentence-transformers/all-MiniLM-L6-v2"
  },
  uploadDir: process.env.UPLOAD_DIR ?? "uploads"
};
