import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@company-rag/database";
import {
  AiProvider,
  AuditAction,
  CompanyStatus,
  Department,
  DocumentChunk,
  DocumentCategory,
  DocumentStatus,
  Prisma,
  Role
} from "@company-rag/database";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { buildChromaAccessFilter, canAccess } from "../access/policy.js";
import { getAiClient } from "../ai/providers.js";
import { audit } from "../audit/audit.js";
import { hashPassword } from "../auth/passwords.js";
import { config } from "../config.js";
import { chunkBlocks, roughTokenCount } from "../rag/chunk.js";
import { upsertChunks, queryChunks } from "../rag/chroma.js";
import { composeAskResult } from "../rag/citations.js";
import { extractText } from "../rag/extractText.js";
import { buildChunkMetadata } from "../rag/metadata.js";
import { buildAskPrompt } from "../rag/prompt.js";
import type { AiProviderName, StoredCitations } from "../types.js";
import { asyncHandler } from "./asyncHandler.js";
import { getPrincipal, requireRole, HttpError } from "./auth.js";

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

// Multer delivers form fields as strings, so array fields arrive JSON-encoded.
const jsonArray = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.length > 0 ? JSON.parse(value) : value),
    z.array(inner)
  );

const documentSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.nativeEnum(DocumentCategory).default(DocumentCategory.OTHER),
  // Fail closed: a document uploaded without explicit access rules is admin-only.
  allowedRoles: jsonArray(z.nativeEnum(Role)).default([Role.ADMIN]),
  allowedDepartments: jsonArray(z.nativeEnum(Department)).default([])
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

const demoUsers: { email: string; name: string; roles: Role[]; department: Department }[] = [
  { email: "admin@demo-company.test", name: "Demo Admin", roles: [Role.ADMIN], department: Department.LEADERSHIP },
  { email: "hr@demo-company.test", name: "Demo HR", roles: [Role.HR], department: Department.HR },
  { email: "legal@demo-company.test", name: "Demo Legal", roles: [Role.LEGAL], department: Department.LEGAL },
  { email: "employee@demo-company.test", name: "Demo Employee", roles: [Role.EMPLOYEE], department: Department.ENGINEERING },
  { email: "contractor@demo-company.test", name: "Demo Contractor", roles: [Role.CONTRACTOR], department: Department.GENERAL }
];

router.post(
  "/setup/demo",
  asyncHandler(async (_request, response) => {
    // Demo bootstrap is for local/dev use only; disabled unless configured.
    if (!config.enableDemoSetup) {
      throw new HttpError(404, "Not found.");
    }

    const company = await prisma.company.upsert({
      where: { slug: "demo-company" },
      update: { status: CompanyStatus.ACTIVE },
      create: { name: "Demo Company", slug: "demo-company", status: CompanyStatus.ACTIVE }
    });

    // All personas share one hashed demo password and are pre-verified so the
    // login flow works out of the box (also heals pre-auth demo users).
    const demoPasswordHash = await hashPassword("demo-password");

    const users = [];
    for (const demoUser of demoUsers) {
      users.push(
        await prisma.user.upsert({
          where: { companyId_email: { companyId: company.id, email: demoUser.email } },
          update: {
            roles: demoUser.roles,
            department: demoUser.department,
            name: demoUser.name,
            passwordHash: demoPasswordHash,
            emailVerifiedAt: new Date()
          },
          create: {
            ...demoUser,
            companyId: company.id,
            passwordHash: demoPasswordHash,
            emailVerifiedAt: new Date()
          }
        })
      );
    }

    response.json({
      companyId: company.id,
      password: "demo-password",
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        department: user.department
      }))
    });
  })
);

router.get(
  "/documents",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    // Existence is access-controlled too: non-admins only see documents their
    // roles or department can read (same rule as canAccess, in Prisma terms).
    const accessFilter = principal.roles.includes(Role.ADMIN)
      ? {}
      : {
          OR: [
            { allowedRoles: { hasSome: principal.roles } },
            { allowedDepartments: { has: principal.department } }
          ]
        };

    const documents = await prisma.document.findMany({
      where: { companyId: principal.companyId, ...accessFilter },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { chunks: true } } }
    });

    response.json({ documents });
  })
);

router.post(
  "/documents",
  requireRole(Role.ADMIN),
  upload.single("file"),
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const file = request.file;
    if (!file) {
      response.status(400).json({ error: "A document file is required." });
      return;
    }

    const parsed = documentSchema.parse(request.body);
    const explicitlyClassified =
      request.body.allowedRoles !== undefined || request.body.allowedDepartments !== undefined;
    const acl = { allowedRoles: parsed.allowedRoles, allowedDepartments: parsed.allowedDepartments };

    const document = await prisma.document.create({
      data: {
        companyId: principal.companyId,
        title: parsed.title || path.parse(file.originalname).name,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storagePath: file.path,
        category: parsed.category,
        allowedRoles: acl.allowedRoles,
        allowedDepartments: acl.allowedDepartments,
        classifiedAt: explicitlyClassified ? new Date() : null,
        classifiedById: explicitlyClassified ? principal.userId : null,
        status: DocumentStatus.PROCESSING
      }
    });

    try {
      const blocks = await extractText(file.path, file.mimetype);
      const chunks = chunkBlocks(blocks);

      if (chunks.length === 0) {
        throw new Error("No extractable text was found in this document.");
      }

      const ai = getAiClient(selectedProvider(config.defaultProvider));
      const embeddings = await ai.embed(chunks.map((chunk) => chunk.content));
      const createdChunks: DocumentChunk[] = await prisma.$transaction(
        chunks.map((chunk, index) =>
          prisma.documentChunk.create({
            data: {
              documentId: document.id,
              companyId: principal.companyId,
              index,
              content: chunk.content,
              tokenCount: roughTokenCount(chunk.content),
              section: chunk.section ?? null,
              pageStart: chunk.pageStart ?? null,
              pageEnd: chunk.pageEnd ?? null,
              chromaId: `${document.id}:${index}`
            }
          })
        )
      );

      await upsertChunks({
        ids: createdChunks.map((chunk) => chunk.chromaId),
        embeddings,
        documents: chunks.map((chunk) => chunk.content),
        metadatas: createdChunks.map((chunk) => buildChunkMetadata(document, chunk, acl))
      });

      const readyDocument = await prisma.document.update({
        where: { id: document.id },
        data: { status: DocumentStatus.READY },
        include: { _count: { select: { chunks: true } } }
      });

      await audit(principal, AuditAction.DOC_UPLOAD, {
        documentId: document.id,
        title: document.title,
        allowedRoles: acl.allowedRoles,
        allowedDepartments: acl.allowedDepartments,
        explicitlyClassified
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

router.get(
  "/documents/:id/file",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const document = await prisma.document.findFirst({
      where: { id: request.params.id, companyId: principal.companyId }
    });

    // 404 for both "does not exist" and "not allowed" — existence of a
    // restricted document must not be disclosed.
    if (!document || !canAccess(principal, document)) {
      throw new HttpError(404, "Document not found.");
    }

    await audit(principal, AuditAction.DOC_DOWNLOAD, { documentId: document.id });

    const safeName = document.originalName.replace(/[^\w.\- ]/g, "_");
    response.setHeader("Content-Type", document.mimeType);
    response.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    createReadStream(document.storagePath)
      .on("error", () => {
        if (!response.headersSent) {
          response.removeHeader("Content-Disposition");
        }
        response.status(410).json({ error: "The stored file is no longer available." });
      })
      .pipe(response);
  })
);

router.post(
  "/ask",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const parsed = askSchema.parse(request.body);
    const provider = selectedProvider(parsed.provider ?? config.defaultProvider);
    const ai = getAiClient(provider);
    const providerEnum = provider === "huggingface" ? AiProvider.HUGGINGFACE : AiProvider.OPENAI;

    // Access control is enforced inside the vector query: the filter is part
    // of the similarity search, so unauthorized chunks are never retrieved.
    const accessWhere = buildChromaAccessFilter(principal);
    const [questionEmbedding] = await ai.embed([parsed.question]);
    const chunks = accessWhere
      ? await queryChunks({ embedding: questionEmbedding, accessWhere, limit: 6 })
      : [];

    // Nothing retrieved — because nothing matched OR nothing was authorized.
    // The response is identical in both cases, so restricted content's
    // existence is never disclosed. No LLM call: nothing can be fabricated.
    if (chunks.length === 0) {
      const answer =
        "I don't have any company documents that cover this question. Try uploading the relevant document or asking the document owner.";
      const citations: StoredCitations = { version: 2, grounded: false, sources: [], retrieved: [] };
      const saved = await prisma.question.create({
        data: {
          companyId: principal.companyId,
          userId: principal.userId,
          provider: providerEnum,
          question: parsed.question,
          answer,
          citations: citations as unknown as Prisma.InputJsonValue
        }
      });

      await audit(principal, AuditAction.ASK, {
        question: parsed.question,
        questionId: saved.id,
        retrievedChunkIds: [],
        citedChunkIds: []
      });

      response.json({ answer, sources: [], grounded: false, questionId: saved.id });
      return;
    }

    const prompt = buildAskPrompt(parsed.question, chunks);
    const rawAnswer = await ai.answer(prompt);
    const result = composeAskResult(rawAnswer, chunks);
    const citations: StoredCitations = {
      version: 2,
      grounded: result.grounded,
      sources: result.sources,
      retrieved: result.retrieved
    };

    const saved = await prisma.question.create({
      data: {
        companyId: principal.companyId,
        userId: principal.userId,
        provider: providerEnum,
        question: parsed.question,
        answer: result.answer,
        citations: citations as unknown as Prisma.InputJsonValue
      }
    });

    await audit(principal, AuditAction.ASK, {
      question: parsed.question,
      questionId: saved.id,
      retrievedChunkIds: chunks.map((chunk) => chunk.chunkDbId ?? chunk.chromaId),
      citedChunkIds: result.sources.map((source) => source.chunkId)
    });

    response.json({
      answer: result.answer,
      sources: result.sources,
      grounded: result.grounded,
      questionId: saved.id
    });
  })
);

router.get(
  "/questions",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    // History is per-user: a question's answer may embed content from
    // documents the reader cannot access. Admins may widen the scope.
    const isAdmin = principal.roles.includes(Role.ADMIN);
    const requestedUserId = typeof request.query.userId === "string" ? request.query.userId : undefined;
    const userFilter = isAdmin ? (requestedUserId ? { userId: requestedUserId } : {}) : { userId: principal.userId };

    const questions = await prisma.question.findMany({
      where: { companyId: principal.companyId, ...userFilter },
      orderBy: { createdAt: "desc" },
      take: 25
    });

    response.json({ questions });
  })
);

export { router };
