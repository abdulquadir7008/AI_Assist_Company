import { AuditAction, CompanyStatus, prisma } from "@company-rag/database";
import express, { type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { auditSystem } from "../audit/audit.js";
import { verifyPassword } from "../auth/passwords.js";
import { signToken, verifyToken } from "../auth/tokens.js";
import { config } from "../config.js";
import { asyncHandler } from "./asyncHandler.js";
import { HttpError } from "./auth.js";

/**
 * Platform-level operations only. Root deliberately has NO endpoints that
 * touch Document, Question, DocumentChunk, AuditLog, or the vector store —
 * tenant data isolation is enforced by absence, plus the token-scope wall:
 * root tokens carry typ "root" and are rejected by the tenant `authenticate`,
 * while user tokens are rejected here.
 */
const rootRouter = express.Router();

const rootLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

const requireRoot: RequestHandler = (request, response, next) => {
  void (async () => {
    const header = request.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      throw new HttpError(401, "Authentication required.");
    }

    let sub: string;
    try {
      ({ sub } = verifyToken(token, "root", config.auth.jwtSecret));
    } catch {
      throw new HttpError(401, "Invalid or expired session.");
    }

    const rootAdmin = await prisma.rootAdmin.findUnique({ where: { id: sub } });
    if (!rootAdmin) {
      throw new HttpError(401, "Unknown root admin.");
    }

    response.locals.rootAdmin = { id: rootAdmin.id, email: rootAdmin.email };
    next();
  })().catch(next);
};

rootRouter.post(
  "/login",
  rootLoginLimiter,
  asyncHandler(async (request, response) => {
    const parsed = z
      .object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) })
      .parse(request.body);

    const rootAdmin = await prisma.rootAdmin.findUnique({ where: { email: parsed.email } });
    const passwordOk = rootAdmin
      ? await verifyPassword(parsed.password, rootAdmin.passwordHash)
      : false;

    if (!rootAdmin || !passwordOk) {
      throw new HttpError(401, "Invalid email or password.");
    }

    const token = signToken(
      { sub: rootAdmin.id, typ: "root" },
      config.auth.jwtSecret,
      config.auth.jwtExpiresIn
    );
    response.json({ token, rootAdmin: { id: rootAdmin.id, email: rootAdmin.email } });
  })
);

rootRouter.use(requireRoot);

rootRouter.get(
  "/companies",
  asyncHandler(async (_request, response) => {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { users: true, documents: true } } }
    });
    response.json({
      companies: companies.map((company) => ({
        id: company.id,
        name: company.name,
        slug: company.slug,
        status: company.status,
        userCount: company._count.users,
        documentCount: company._count.documents,
        createdAt: company.createdAt
      }))
    });
  })
);

rootRouter.get(
  "/companies/:id/users",
  asyncHandler(async (request, response) => {
    const company = await prisma.company.findUnique({ where: { id: request.params.id } });
    if (!company) {
      throw new HttpError(404, "Company not found.");
    }
    // The minimum needed to manually verify someone — no roles, no content.
    const users = await prisma.user.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, name: true, emailVerifiedAt: true, createdAt: true }
    });
    response.json({ users });
  })
);

rootRouter.patch(
  "/companies/:id",
  asyncHandler(async (request, response) => {
    const parsed = z
      .object({ status: z.enum([CompanyStatus.ACTIVE, CompanyStatus.SUSPENDED]) })
      .parse(request.body);

    const company = await prisma.company.findUnique({ where: { id: request.params.id } });
    if (!company) {
      throw new HttpError(404, "Company not found.");
    }

    const updated = await prisma.company.update({
      where: { id: company.id },
      data: { status: parsed.status }
    });

    await auditSystem(company.id, AuditAction.COMPANY_STATUS_CHANGE, {
      rootAdmin: true,
      oldStatus: company.status,
      newStatus: updated.status
    });

    response.json({ ok: true, company: { id: updated.id, status: updated.status } });
  })
);

rootRouter.patch(
  "/users/:id/verify",
  asyncHandler(async (request, response) => {
    const user = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (!user) {
      throw new HttpError(404, "User not found.");
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() }
      }),
      prisma.company.updateMany({
        where: { id: user.companyId, status: CompanyStatus.PENDING_VERIFICATION },
        data: { status: CompanyStatus.ACTIVE }
      })
    ]);

    await auditSystem(user.companyId, AuditAction.VERIFY_EMAIL, {
      rootAdmin: true,
      manual: true,
      targetUserId: user.id,
      email: user.email
    });

    response.json({ ok: true });
  })
);

export { rootRouter };
