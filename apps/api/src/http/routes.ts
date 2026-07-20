import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { prisma } from "@company-rag/database";
import {
  AiProvider,
  AuditAction,
  CompanyStatus,
  Department,
  DocumentCategory,
  DocumentSource,
  Prisma,
  Role
} from "@company-rag/database";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { buildChromaAccessFilter, canAccess } from "../access/policy.js";
import { getAiClient, validateProviderKey } from "../ai/providers.js";
import { audit } from "../audit/audit.js";
import { hashPassword } from "../auth/passwords.js";
import { config } from "../config.js";
import { queryChunks } from "../rag/chroma.js";
import { composeAskResult } from "../rag/citations.js";
import { condenseQuestion, type ConversationTurn } from "../rag/condense.js";
import { ingestDocument } from "../rag/ingest.js";
import { buildAskPrompt } from "../rag/prompt.js";
import { normalizeQuestion, pickStarters } from "../suggestions/starters.js";
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
  provider: z.enum(["openai", "huggingface"]).optional(),
  conversationId: z.string().optional()
});

// Explicit provider wins; otherwise fall back to the configured default
// (Hugging Face in this deployment). OpenAI is only used when asked for.
function selectedProvider(provider?: string): AiProviderName {
  if (provider === "openai" || provider === "huggingface") {
    return provider;
  }
  return config.defaultProvider === "openai" ? "openai" : "huggingface";
}

// The provider used to embed documents at ingestion time — retrieval MUST
// embed queries with the same one or the vector dimensions won't match. This
// stays fixed regardless of which model the user picks to write the answer.
const embeddingProvider: AiProviderName =
  config.defaultProvider === "openai" ? "openai" : "huggingface";

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
            { allowedDepartments: { has: principal.department } },
            // Owner lane: chat uploads stay visible to their uploader.
            { ownerId: principal.userId }
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

    try {
      const document = await ingestDocument({
        principal,
        file,
        title: parsed.title,
        category: parsed.category,
        acl,
        source: DocumentSource.ADMIN,
        explicitlyClassified
      });

      await audit(principal, AuditAction.DOC_UPLOAD, {
        documentId: document.id,
        title: document.title,
        allowedRoles: acl.allowedRoles,
        allowedDepartments: acl.allowedDepartments,
        explicitlyClassified
      });

      response.status(201).json({ document });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Document ingestion failed.";
      const documentId = (error as { documentId?: string }).documentId;
      response.status(422).json({ error: message, documentId });
    }
  })
);

router.post(
  "/documents/chat",
  upload.single("file"),
  asyncHandler(async (request, response) => {
    // Any authenticated user may drop a file into the chat. The document is
    // PRIVATE: admin-only ACL plus the owner lane — only the uploader (and
    // admins) can retrieve or even see it until an admin reclassifies it.
    const principal = getPrincipal(response);
    const file = request.file;
    if (!file) {
      response.status(400).json({ error: "A document file is required." });
      return;
    }

    const parsed = z
      .object({
        title: z.string().min(1).optional(),
        category: z.nativeEnum(DocumentCategory).default(DocumentCategory.OTHER)
      })
      .parse(request.body);

    try {
      const document = await ingestDocument({
        principal,
        file,
        title: parsed.title,
        category: parsed.category,
        acl: { allowedRoles: [Role.ADMIN], allowedDepartments: [], ownerId: principal.userId },
        source: DocumentSource.CHAT,
        explicitlyClassified: false
      });

      await audit(principal, AuditAction.CHAT_UPLOAD, {
        documentId: document.id,
        title: document.title,
        ownerId: principal.userId
      });

      response.status(201).json({ document });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Document ingestion failed.";
      const documentId = (error as { documentId?: string }).documentId;
      response.status(422).json({ error: message, documentId });
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
  "/ai/validate-key",
  asyncHandler(async (request, response) => {
    // Lightweight credential check for the "save key" flow. The key is used
    // for one test call and never stored or logged server-side.
    const body = z
      .object({
        provider: z.enum(["openai", "huggingface"]),
        apiKey: z.string().trim().min(8)
      })
      .parse(request.body);

    // Throws ProviderAuthError (→ 401 + code) on a bad key.
    await validateProviderKey(body.provider, body.apiKey);
    response.json({ ok: true, provider: body.provider });
  })
);

router.post(
  "/ask",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const parsed = askSchema.parse(request.body);
    const provider = selectedProvider(parsed.provider);
    const providerEnum = provider === "huggingface" ? AiProvider.HUGGINGFACE : AiProvider.OPENAI;

    // The user may bring their own OpenAI key (per request, from the browser).
    const userOpenAiKey =
      provider === "openai" ? request.header("x-openai-key")?.trim() || undefined : undefined;

    // Two clients: retrieval always embeds with the ingestion provider so
    // query vectors match the stored ones; the answer is written by the
    // provider the user selected (with their key if OpenAI).
    const embedClient = getAiClient(embeddingProvider);
    const answerClient = getAiClient(provider, userOpenAiKey);

    // Multi-turn: the conversation must belong to the requester — history may
    // embed content from documents no one else is allowed to read.
    let conversation =
      parsed.conversationId !== undefined
        ? await prisma.conversation.findFirst({
            where: {
              id: parsed.conversationId,
              companyId: principal.companyId,
              userId: principal.userId
            }
          })
        : null;
    if (parsed.conversationId !== undefined && !conversation) {
      throw new HttpError(404, "Conversation not found.");
    }

    const history: ConversationTurn[] = conversation
      ? (
          await prisma.question.findMany({
            where: { conversationId: conversation.id },
            orderBy: { createdAt: "desc" },
            take: 6,
            select: { question: true, answer: true }
          })
        ).reverse()
      : [];

    // Follow-ups embed poorly as search queries ("what about remote
    // employees?"), so fold the context in first. The RBAC filter applies to
    // whatever gets embedded — condensing never widens access.
    const retrievalQuestion = await condenseQuestion(answerClient, parsed.question, history);

    // Access control is enforced inside the vector query: the filter is part
    // of the similarity search, so unauthorized chunks are never retrieved.
    const accessWhere = buildChromaAccessFilter(principal);
    const [questionEmbedding] = await embedClient.embed([retrievalQuestion]);
    const chunks = accessWhere
      ? await queryChunks({ embedding: questionEmbedding, accessWhere, limit: 6 })
      : [];

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          companyId: principal.companyId,
          userId: principal.userId,
          title: parsed.question.slice(0, 60)
        }
      });
    } else {
      // Bump updatedAt so the sidebar sorts by recent activity.
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {}
      });
    }

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
          conversationId: conversation.id,
          provider: providerEnum,
          question: parsed.question,
          answer,
          citations: citations as unknown as Prisma.InputJsonValue
        }
      });

      await audit(principal, AuditAction.ASK, {
        question: parsed.question,
        retrievalQuestion,
        questionId: saved.id,
        conversationId: conversation.id,
        retrievedChunkIds: [],
        citedChunkIds: []
      });

      response.json({
        answer,
        sources: [],
        grounded: false,
        questionId: saved.id,
        conversationId: conversation.id,
        conversationTitle: conversation.title
      });
      return;
    }

    const prompt = buildAskPrompt(parsed.question, chunks, history);
    const rawAnswer = await answerClient.answer(prompt);
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
        conversationId: conversation.id,
        provider: providerEnum,
        question: parsed.question,
        answer: result.answer,
        citations: citations as unknown as Prisma.InputJsonValue
      }
    });

    await audit(principal, AuditAction.ASK, {
      question: parsed.question,
      retrievalQuestion,
      questionId: saved.id,
      conversationId: conversation.id,
      retrievedChunkIds: chunks.map((chunk) => chunk.chunkDbId ?? chunk.chromaId),
      citedChunkIds: result.sources.map((source) => source.chunkId)
    });

    response.json({
      answer: result.answer,
      sources: result.sources,
      grounded: result.grounded,
      questionId: saved.id,
      conversationId: conversation.id,
      conversationTitle: conversation.title
    });
  })
);

// ---- Conversations (strictly per-user; even admins cannot read others') ----

router.get(
  "/conversations",
  asyncHandler(async (_request, response) => {
    const principal = getPrincipal(response);
    const conversations = await prisma.conversation.findMany({
      where: { companyId: principal.companyId, userId: principal.userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { _count: { select: { questions: true } } }
    });
    response.json({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        messageCount: conversation._count.questions,
        updatedAt: conversation.updatedAt
      }))
    });
  })
);

router.get(
  "/conversations/:id",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const conversation = await prisma.conversation.findFirst({
      where: { id: request.params.id, companyId: principal.companyId, userId: principal.userId },
      include: { questions: { orderBy: { createdAt: "asc" } } }
    });
    if (!conversation) {
      throw new HttpError(404, "Conversation not found.");
    }
    response.json({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        messages: conversation.questions.map((question) => {
          const citations = question.citations as unknown as Partial<StoredCitations> | null;
          return {
            questionId: question.id,
            question: question.question,
            answer: question.answer,
            sources: citations?.version === 2 ? (citations.sources ?? []) : [],
            grounded: citations?.version === 2 ? (citations.grounded ?? false) : true,
            createdAt: question.createdAt
          };
        })
      }
    });
  })
);

router.delete(
  "/conversations/:id",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const conversation = await prisma.conversation.findFirst({
      where: { id: request.params.id, companyId: principal.companyId, userId: principal.userId }
    });
    if (!conversation) {
      throw new HttpError(404, "Conversation not found.");
    }
    // Questions keep their audit value: conversationId is set null on delete.
    await prisma.conversation.delete({ where: { id: conversation.id } });
    await audit(principal, AuditAction.CONVERSATION_DELETE, {
      conversationId: conversation.id,
      title: conversation.title
    });
    response.json({ ok: true });
  })
);

// ---- Suggested questions ----

router.get(
  "/suggestions",
  asyncHandler(async (_request, response) => {
    const principal = getPrincipal(response);
    const SUGGESTION_COUNT = 4;

    // Popular candidates: grounded questions asked by the requester's
    // department in the last 30 days.
    const departmentUsers = await prisma.user.findMany({
      where: { companyId: principal.companyId, department: principal.department },
      select: { id: true }
    });
    const recent = await prisma.question.findMany({
      where: {
        companyId: principal.companyId,
        userId: { in: departmentUsers.map((user) => user.id) },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { question: true, citations: true }
    });

    // Group identical questions; keep the cited documentIds of each group.
    const groups = new Map<string, { question: string; count: number; documentIds: Set<string> }>();
    for (const entry of recent) {
      const citations = entry.citations as unknown as Partial<StoredCitations> | null;
      if (citations?.version !== 2 || !citations.grounded || !citations.sources?.length) {
        continue;
      }
      const key = normalizeQuestion(entry.question);
      const group = groups.get(key) ?? {
        question: entry.question,
        count: 0,
        documentIds: new Set<string>()
      };
      group.count += 1;
      for (const source of citations.sources) {
        group.documentIds.add(source.documentId);
      }
      groups.set(key, group);
    }

    // Leak gate: a popular question is only shown if EVERY document its
    // answers cited is accessible to the viewer — a Contractor never learns
    // what HR is asking about restricted policies.
    const allDocumentIds = [...new Set([...groups.values()].flatMap((g) => [...g.documentIds]))];
    const documents = allDocumentIds.length
      ? await prisma.document.findMany({
          where: { id: { in: allDocumentIds }, companyId: principal.companyId }
        })
      : [];
    const documentById = new Map(documents.map((document) => [document.id, document]));

    const popular = [...groups.values()]
      .filter((group) =>
        [...group.documentIds].every((documentId) => {
          const document = documentById.get(documentId);
          return document !== undefined && canAccess(principal, document);
        })
      )
      .sort((a, b) => b.count - a.count)
      .slice(0, SUGGESTION_COUNT)
      .map((group) => ({ question: group.question, source: "popular" as const }));

    const starters = pickStarters(
      principal.department,
      SUGGESTION_COUNT - popular.length,
      popular.map((item) => item.question)
    ).map((question) => ({ question, source: "starter" as const }));

    response.json({ suggestions: [...popular, ...starters] });
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
