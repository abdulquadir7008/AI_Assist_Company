import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@company-rag/database";
import {
  AiProvider,
  DocumentChunk,
  DocumentCategory,
  DocumentStatus,
  Prisma,
  Visibility
} from "@company-rag/database";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { getAiClient } from "../ai/providers.js";
import { config } from "../config.js";
import { chunkText, roughTokenCount } from "../rag/chunk.js";
import { upsertChunks, queryChunks } from "../rag/chroma.js";
import { extractText } from "../rag/extractText.js";
import type { AiProviderName, Citation } from "../types.js";
import { asyncHandler } from "./asyncHandler.js";
import { getRequestContext } from "./context.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination: async (_request, _file, callback) => {
    try {
      await fs.mkdir(config.uploadDir, { recursive: true });
      callback(null, config.uploadDir);
    } catch (error) {
      callback(error as Error, config.uploadDir);
    }
  },
  filename: (_request, file, callback) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    callback(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

const documentSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.nativeEnum(DocumentCategory).default(DocumentCategory.OTHER),
  visibility: z.nativeEnum(Visibility).default(Visibility.COMPANY)
});

const askSchema = z.object({
  question: z.string().min(2),
  provider: z.enum(["openai", "huggingface"]).optional()
});

function selectedProvider(provider?: string): AiProviderName {
  return provider === "huggingface" ? "huggingface" : "openai";
}

router.get("/health", (_request, response) => {
  response.json({ ok: true });
});

router.post(
  "/setup/demo",
  asyncHandler(async (_request, response) => {
    const company = await prisma.company.upsert({
      where: { slug: "demo-company" },
      update: {},
      create: {
        name: "Demo Company",
        slug: "demo-company",
        users: {
          create: {
            email: "employee@demo-company.test",
            name: "Demo Employee"
          }
        }
      },
      include: { users: true }
    });

    response.json({
      companyId: company.id,
      userId: company.users[0]?.id,
      headers: {
        "x-company-id": company.id,
        "x-user-id": company.users[0]?.id
      }
    });
  })
);

router.get(
  "/documents",
  asyncHandler(async (request, response) => {
    const { companyId } = getRequestContext(request);
    const documents = await prisma.document.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { chunks: true } } }
    });

    response.json({ documents });
  })
);

router.post(
  "/documents",
  upload.single("file"),
  asyncHandler(async (request, response) => {
    const { companyId } = getRequestContext(request);
    const file = request.file;
    if (!file) {
      response.status(400).json({ error: "A document file is required." });
      return;
    }

    const parsed = documentSchema.parse(request.body);
    const document = await prisma.document.create({
      data: {
        companyId,
        title: parsed.title || path.parse(file.originalname).name,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storagePath: file.path,
        category: parsed.category,
        visibility: parsed.visibility,
        status: DocumentStatus.PROCESSING
      }
    });

    try {
      const rawText = await extractText(file.path, file.mimetype);
      const chunks = chunkText(rawText);

      if (chunks.length === 0) {
        throw new Error("No extractable text was found in this document.");
      }

      const ai = getAiClient(selectedProvider(config.defaultProvider));
      const embeddings = await ai.embed(chunks);
      const createdChunks: DocumentChunk[] = await prisma.$transaction(
        chunks.map((content, index) =>
          prisma.documentChunk.create({
            data: {
              documentId: document.id,
              companyId,
              index,
              content,
              tokenCount: roughTokenCount(content),
              chromaId: `${document.id}:${index}`
            }
          })
        )
      );

      await upsertChunks({
        ids: createdChunks.map((chunk) => chunk.chromaId),
        embeddings,
        documents: chunks,
        metadatas: createdChunks.map((chunk) => ({
          companyId,
          documentId: document.id,
          chunkId: chunk.id,
          title: document.title,
          category: document.category,
          visibility: document.visibility
        }))
      });

      const readyDocument = await prisma.document.update({
        where: { id: document.id },
        data: { status: DocumentStatus.READY },
        include: { _count: { select: { chunks: true } } }
      });

      response.status(201).json({ document: readyDocument });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Document ingestion failed.";
      await prisma.document.update({
        where: { id: document.id },
        data: { status: DocumentStatus.FAILED, failureReason: message }
      });
      response.status(422).json({ error: message, documentId: document.id });
    }
  })
);

router.post(
  "/ask",
  asyncHandler(async (request, response) => {
    const { companyId, userId } = getRequestContext(request);
    const parsed = askSchema.parse(request.body);
    const provider = selectedProvider(parsed.provider ?? config.defaultProvider);
    const ai = getAiClient(provider);
    const [questionEmbedding] = await ai.embed([parsed.question]);
    const chunks = await queryChunks({ embedding: questionEmbedding, companyId, limit: 6 });

    const context = chunks
      .map((chunk, index) => `Source ${index + 1}: ${chunk.title}\n${chunk.content}`)
      .join("\n\n");
    const answer = await ai.answer(parsed.question, context || "No matching company context found.");
    const citations: Citation[] = chunks.map((chunk) => ({
      documentId: chunk.documentId,
      title: chunk.title,
      category: chunk.category,
      chunkId: chunk.chromaId
    }));

    const saved = await prisma.question.create({
      data: {
        companyId,
        userId,
        provider: provider === "huggingface" ? AiProvider.HUGGINGFACE : AiProvider.OPENAI,
        question: parsed.question,
        answer,
        citations: citations as unknown as Prisma.InputJsonValue
      }
    });

    response.json({ answer, citations, questionId: saved.id });
  })
);

router.get(
  "/questions",
  asyncHandler(async (request, response) => {
    const { companyId } = getRequestContext(request);
    const questions = await prisma.question.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 25
    });

    response.json({ questions });
  })
);

export { router };
