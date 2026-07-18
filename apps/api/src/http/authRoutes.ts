import {
  AuditAction,
  CompanyStatus,
  Department,
  prisma,
  Prisma,
  Role
} from "@company-rag/database";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { audit, auditSystem } from "../audit/audit.js";
import { CODE_TTL_MS, codeState, generateCode, hashCode } from "../auth/codes.js";
import { evaluateLogin } from "../auth/loginPolicy.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { slugify, withSuffix } from "../auth/slug.js";
import { signToken } from "../auth/tokens.js";
import { config } from "../config.js";
import { sendVerificationCode } from "../email/mailer.js";
import { asyncHandler } from "./asyncHandler.js";
import { authenticate, getPrincipal, HttpError } from "./auth.js";

const authRouter = express.Router();

// Broad limiter for the whole auth surface, tighter one for guessable inputs.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(80),
  userName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128)
});

const verifySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().regex(/^\d{6}$/)
});

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email() });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128)
});

function publicUser(user: {
  id: string;
  email: string;
  name: string | null;
  roles: Role[];
  department: Department;
  companyId: string;
  mustChangePassword: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    department: user.department,
    companyId: user.companyId,
    mustChangePassword: user.mustChangePassword
  };
}

async function issueVerificationCode(userId: string) {
  const code = generateCode();
  // A fresh code invalidates all previous ones.
  await prisma.verificationCode.deleteMany({ where: { userId } });
  await prisma.verificationCode.create({
    data: {
      userId,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS)
    }
  });
  return code;
}

authRouter.post(
  "/register",
  asyncHandler(async (request, response) => {
    const parsed = registerSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
    if (existing) {
      response.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const passwordHash = await hashPassword(parsed.password);

    // Slug uniqueness: retry with a numeric suffix on collision.
    const baseSlug = slugify(parsed.companyName);
    let company = null;
    for (let attempt = 0; company === null && attempt < 20; attempt++) {
      const slug = attempt === 0 ? baseSlug : withSuffix(baseSlug, attempt + 1);
      try {
        company = await prisma.company.create({
          data: { name: parsed.companyName, slug, status: CompanyStatus.PENDING_VERIFICATION }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }
        throw error;
      }
    }
    if (!company) {
      throw new Error("Could not allocate a unique company identifier.");
    }

    // The registrant owns the new workspace.
    const user = await prisma.user.create({
      data: {
        email: parsed.email,
        name: parsed.userName,
        passwordHash,
        roles: [Role.ADMIN],
        department: Department.LEADERSHIP,
        companyId: company.id
      }
    });

    const code = await issueVerificationCode(user.id);
    const delivery = await sendVerificationCode(user.email, code);

    await auditSystem(company.id, AuditAction.REGISTER, {
      selfService: true,
      email: user.email,
      companyName: company.name
    });

    response.status(201).json({
      ok: true,
      email: user.email,
      message: delivery.delivered
        ? "Check your email for a 6-digit verification code."
        : "No email service configured — your verification code is shown below (dev mode).",
      ...(delivery.devCode ? { devVerificationCode: delivery.devCode } : {})
    });
  })
);

authRouter.post(
  "/verify",
  strictLimiter,
  asyncHandler(async (request, response) => {
    const parsed = verifySchema.parse(request.body);
    // Every failure mode gets the same response — no oracle for attackers.
    const genericFailure = () =>
      response.status(400).json({ error: "Invalid or expired code." });

    const user = await prisma.user.findUnique({
      where: { email: parsed.email },
      include: { verificationCodes: { orderBy: { createdAt: "desc" }, take: 1 } }
    });
    const record = user?.verificationCodes[0];
    if (!user || !record || codeState(record) !== "valid") {
      genericFailure();
      return;
    }

    if (record.codeHash !== hashCode(parsed.code)) {
      await prisma.verificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } }
      });
      genericFailure();
      return;
    }

    await prisma.$transaction([
      prisma.verificationCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() }
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() }
      }),
      prisma.company.updateMany({
        where: { id: user.companyId, status: CompanyStatus.PENDING_VERIFICATION },
        data: { status: CompanyStatus.ACTIVE }
      })
    ]);

    await auditSystem(user.companyId, AuditAction.VERIFY_EMAIL, {
      selfService: true,
      userId: user.id,
      email: user.email
    });

    response.json({ ok: true });
  })
);

authRouter.post(
  "/resend-code",
  strictLimiter,
  asyncHandler(async (request, response) => {
    const parsed = emailSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: parsed.email } });

    let devCode: string | undefined;
    if (user && !user.emailVerifiedAt) {
      const code = await issueVerificationCode(user.id);
      const delivery = await sendVerificationCode(user.email, code);
      devCode = delivery.devCode;
    }

    // Always 200 — the response never reveals whether the email exists.
    response.json({ ok: true, ...(devCode ? { devVerificationCode: devCode } : {}) });
  })
);

authRouter.post(
  "/login",
  strictLimiter,
  asyncHandler(async (request, response) => {
    const parsed = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: parsed.email },
      include: { company: true }
    });

    const passwordOk = user?.passwordHash
      ? await verifyPassword(parsed.password, user.passwordHash)
      : false;

    const decision = evaluateLogin({
      userFound: user !== null,
      hasPassword: Boolean(user?.passwordHash),
      passwordOk,
      emailVerified: Boolean(user?.emailVerifiedAt),
      companyStatus: user?.company.status ?? null
    });

    if (!decision.ok) {
      response.status(decision.status).json({ error: decision.message, code: decision.code });
      return;
    }

    const verified = user!;
    const token = signToken(
      { sub: verified.id, typ: "user" },
      config.auth.jwtSecret,
      config.auth.jwtExpiresIn
    );

    await audit(
      {
        userId: verified.id,
        companyId: verified.companyId,
        roles: verified.roles,
        department: verified.department
      },
      AuditAction.LOGIN,
      { email: verified.email }
    );

    response.json({ token, user: publicUser(verified) });
  })
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (_request, response) => {
    const principal = getPrincipal(response);
    const user = await prisma.user.findUnique({ where: { id: principal.userId } });
    if (!user) {
      throw new HttpError(401, "Unknown user.");
    }
    response.json({ user: publicUser(user) });
  })
);

authRouter.post(
  "/change-password",
  authenticate,
  asyncHandler(async (request, response) => {
    const principal = getPrincipal(response);
    const parsed = changePasswordSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { id: principal.userId } });
    if (!user?.passwordHash || !(await verifyPassword(parsed.currentPassword, user.passwordHash))) {
      throw new HttpError(403, "Current password is incorrect.");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsed.newPassword), mustChangePassword: false }
    });

    await audit(principal, AuditAction.PASSWORD_CHANGE, {});
    response.json({ ok: true });
  })
);

export { authRouter };
