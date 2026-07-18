import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set (>=16 chars) in production. Generate one with: openssl rand -hex 32");
  }
  console.warn("[config] JWT_SECRET not set — using an insecure dev-only fallback.");
  return "dev-only-insecure-secret-do-not-use-in-production";
}

export const config = {
  apiPort: Number(process.env.API_PORT ?? 4000),
  chromaUrl: process.env.CHROMA_URL ?? "http://localhost:8000",
  chromaCollection: process.env.CHROMA_COLLECTION ?? "company_documents",
  defaultProvider: (process.env.DEFAULT_AI_PROVIDER ?? "openai").toLowerCase(),
  auth: {
    jwtSecret: resolveJwtSecret(),
    jwtExpiresIn: "7d",
    bcryptRounds: 10
  },
  rootAdmin: {
    email: process.env.ROOT_ADMIN_EMAIL,
    password: process.env.ROOT_ADMIN_PASSWORD
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? "no-reply@company-rag.local"
  },
  enableDemoSetup:
    (process.env.ENABLE_DEMO_SETUP ?? (process.env.NODE_ENV === "production" ? "false" : "true")) ===
    "true",
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
