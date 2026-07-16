import { prisma } from "@company-rag/database";
import {
  AuditAction,
  Department,
  DocumentCategory,
  Role
} from "@company-rag/database";
import express from "express";
import { z } from "zod";
import { canAccess, effectiveChunkAcl, type Acl } from "../access/policy.js";
import { audit } from "../audit/audit.js";
import { updateChunkMetadata } from "../rag/chroma.js";
import { buildChunkMetadata } from "../rag/metadata.js";
import { asyncHandler } from "./asyncHandler.js";
import { getPrincipal, requireRole, HttpError } from "./auth.js";

const adminRouter = express.Router();

adminRouter.use(requireRole(Role.ADMIN));

const aclSchema = z.object({
  allowedRoles: z.array(z.nativeEnum(Role)),
  allowedDepartments: z.array(z.nativeEnum(Department))
});

const CHROMA_UPDATE_BATCH = 200;

/**
 * Rewrite the complete Chroma metadata for every chunk of the given documents
 * so the retrieval-layer ACL flags match Postgres. Postgres is updated first;
 * if this throws, the caller returns 502 and the operation must be retried
 * (idempotent full-dict rewrite).
 */
async function syncDocumentChunksToChroma(documentIds: string[]) {
  for (const documentId of documentIds) {
    const document = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { chunks: true }
    });
    const docAcl: Acl = {
      allowedRoles: document.allowedRoles,
      allowedDepartments: document.allowedDepartments
    };

    for (let start = 0; start < document.chunks.length; start += CHROMA_UPDATE_BATCH) {
      const batch = document.chunks.slice(start, start + CHROMA_UPDATE_BATCH);
      await updateChunkMetadata({
        ids: batch.map((chunk) => chunk.chromaId),
        metadatas: batch.map((chunk) =>
          buildChunkMetadata(document, chunk, effectiveChunkAcl(docAcl, chunk))
        )
      });
    }
  }
}

adminRouter.get(
  "/users",
  asyncHandler(async (_request, response) => {
    const principal = getPrincipal(response);
    const users = await prisma.user.findMany({
      where: { companyId: principal.companyId },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, name: true, roles: true, department: true }
    });
    response.json({ users });
  })
);

adminRouter.patch(
  "/users/:id",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const body = z
      .object({
        roles: z.array(z.nativeEnum(Role)).min(1).optional(),
        department: z.nativeEnum(Department).optional()
      })
      .parse(request.body);

    const target = await prisma.user.findFirst({
      where: { id: request.params.id, companyId: principal.companyId }
    });
    if (!target) {
      throw new HttpError(404, "User not found.");
    }

    // Lockout guard: an admin cannot remove their own ADMIN role.
    if (
      target.id === principal.userId &&
      body.roles !== undefined &&
      !body.roles.includes(Role.ADMIN)
    ) {
      throw new HttpError(403, "You cannot remove your own admin role.");
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        ...(body.roles !== undefined ? { roles: body.roles } : {}),
        ...(body.department !== undefined ? { department: body.department } : {})
      },
      select: { id: true, email: true, name: true, roles: true, department: true }
    });

    await audit(principal, AuditAction.ROLE_CHANGE, {
      targetUserId: target.id,
      targetEmail: target.email,
      oldRoles: target.roles,
      newRoles: updated.roles,
      oldDepartment: target.department,
      newDepartment: updated.department
    });

    response.json({ user: updated });
  })
);

adminRouter.get(
  "/documents",
  asyncHandler(async (_request, response) => {
    const principal = getPrincipal(response);
    const documents = await prisma.document.findMany({
      where: { companyId: principal.companyId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { chunks: true } },
        chunks: {
          where: { aclOverride: true },
          select: { id: true, index: true, section: true, overrideRoles: true, overrideDepartments: true }
        }
      }
    });

    response.json({
      documents: documents.map((document) => ({
        id: document.id,
        title: document.title,
        originalName: document.originalName,
        category: document.category,
        status: document.status,
        allowedRoles: document.allowedRoles,
        allowedDepartments: document.allowedDepartments,
        unclassified: document.classifiedAt === null,
        classifiedAt: document.classifiedAt,
        legacyVisibilityHint: document.visibility,
        chunkCount: document._count.chunks,
        overriddenChunks: document.chunks,
        createdAt: document.createdAt
      }))
    });
  })
);

async function reclassifyDocuments(
  response: express.Response,
  documentIds: string[],
  acl: Acl
) {
  const principal = getPrincipal(response);
  const documents = await prisma.document.findMany({
    where: { id: { in: documentIds }, companyId: principal.companyId },
    select: { id: true, allowedRoles: true, allowedDepartments: true }
  });
  if (documents.length !== documentIds.length) {
    throw new HttpError(404, "One or more documents were not found.");
  }

  // Postgres first (source of truth), then Chroma (enforcement point).
  await prisma.document.updateMany({
    where: { id: { in: documentIds } },
    data: {
      allowedRoles: acl.allowedRoles,
      allowedDepartments: acl.allowedDepartments,
      classifiedAt: new Date(),
      classifiedById: principal.userId
    }
  });

  try {
    await syncDocumentChunksToChroma(documentIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vector store update failed.";
    // Postgres holds the new ACL but Chroma flags are stale — retrying this
    // endpoint rewrites the full metadata dict, so retry until it returns 200.
    response.status(502).json({
      error: `Access rules were saved but the vector index update failed (${message}). Retry the reclassification.`
    });
    return false;
  }

  await audit(principal, AuditAction.RECLASSIFY, {
    documentIds,
    oldAcl: documents.map((document) => ({
      documentId: document.id,
      allowedRoles: document.allowedRoles,
      allowedDepartments: document.allowedDepartments
    })),
    newAcl: acl
  });
  return true;
}

adminRouter.patch(
  "/documents/:id/access",
  asyncHandler(async (request, response) => {
    const acl = aclSchema.parse(request.body);
    if (await reclassifyDocuments(response, [request.params.id], acl)) {
      response.json({ ok: true, documentId: request.params.id, ...acl });
    }
  })
);

adminRouter.post(
  "/documents/bulk-access",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const body = aclSchema
      .extend({
        documentIds: z.array(z.string()).optional(),
        category: z.nativeEnum(DocumentCategory).optional()
      })
      .refine((value) => value.documentIds?.length || value.category, {
        message: "Provide documentIds or a category."
      })
      .parse(request.body);

    const documentIds = body.documentIds?.length
      ? body.documentIds
      : (
          await prisma.document.findMany({
            where: { companyId: principal.companyId, category: body.category },
            select: { id: true }
          })
        ).map((document) => document.id);

    if (documentIds.length === 0) {
      response.json({ ok: true, updated: 0 });
      return;
    }

    const acl = { allowedRoles: body.allowedRoles, allowedDepartments: body.allowedDepartments };
    if (await reclassifyDocuments(response, documentIds, acl)) {
      response.json({ ok: true, updated: documentIds.length, documentIds });
    }
  })
);

adminRouter.patch(
  "/documents/:documentId/chunks/:chunkId/access",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const body = z
      .union([
        z.object({ clearOverride: z.literal(true) }),
        z.object({
          overrideRoles: z.array(z.nativeEnum(Role)),
          overrideDepartments: z.array(z.nativeEnum(Department))
        })
      ])
      .parse(request.body);

    const chunk = await prisma.documentChunk.findFirst({
      where: {
        id: request.params.chunkId,
        documentId: request.params.documentId,
        companyId: principal.companyId
      },
      include: { document: true }
    });
    if (!chunk) {
      throw new HttpError(404, "Chunk not found.");
    }

    const updated = await prisma.documentChunk.update({
      where: { id: chunk.id },
      data:
        "clearOverride" in body
          ? { aclOverride: false, overrideRoles: [], overrideDepartments: [] }
          : {
              aclOverride: true,
              overrideRoles: body.overrideRoles,
              overrideDepartments: body.overrideDepartments
            }
    });

    const docAcl: Acl = {
      allowedRoles: chunk.document.allowedRoles,
      allowedDepartments: chunk.document.allowedDepartments
    };
    try {
      await updateChunkMetadata({
        ids: [updated.chromaId],
        metadatas: [buildChunkMetadata(chunk.document, updated, effectiveChunkAcl(docAcl, updated))]
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Vector store update failed.";
      response.status(502).json({
        error: `Chunk override was saved but the vector index update failed (${message}). Retry the request.`
      });
      return;
    }

    await audit(principal, AuditAction.CHUNK_RECLASSIFY, {
      documentId: chunk.documentId,
      chunkId: chunk.id,
      aclOverride: updated.aclOverride,
      overrideRoles: updated.overrideRoles,
      overrideDepartments: updated.overrideDepartments
    });

    response.json({
      ok: true,
      chunk: {
        id: updated.id,
        index: updated.index,
        aclOverride: updated.aclOverride,
        overrideRoles: updated.overrideRoles,
        overrideDepartments: updated.overrideDepartments
      }
    });
  })
);

adminRouter.get(
  "/access-matrix",
  asyncHandler(async (_request, response) => {
    const principal = getPrincipal(response);
    const documents = await prisma.document.findMany({
      where: { companyId: principal.companyId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, allowedRoles: true, allowedDepartments: true, classifiedAt: true }
    });

    // Computed with the SAME canAccess predicate that guards the API layer,
    // whose compilation guards retrieval — the matrix shows the enforced rule.
    const roles = Object.values(Role);
    const departments = Object.values(Department);
    response.json({
      roles,
      departments,
      documents: documents.map((document) => {
        // Neutralize the department dimension for role columns by picking a
        // department the document does not grant. If every department is
        // granted, everyone has access regardless of role — true is accurate.
        const neutralDepartment =
          departments.find((department) => !document.allowedDepartments.includes(department)) ??
          Department.GENERAL;
        return {
          id: document.id,
          title: document.title,
          unclassified: document.classifiedAt === null,
          access: Object.fromEntries(
            roles.map((role) => [
              role,
              canAccess({ roles: [role], department: neutralDepartment }, document)
            ])
          ),
          departmentAccess: Object.fromEntries(
            departments.map((department) => [
              department,
              canAccess({ roles: [], department }, document)
            ])
          )
        };
      })
    });
  })
);

adminRouter.get(
  "/audit",
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const limit = Math.min(Number(request.query.limit ?? 50) || 50, 200);
    const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;

    const entries = await prisma.auditLog.findMany({
      where: { companyId: principal.companyId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });

    const hasMore = entries.length > limit;
    response.json({
      entries: entries.slice(0, limit),
      nextCursor: hasMore ? entries[limit - 1].id : null
    });
  })
);

export { adminRouter };
