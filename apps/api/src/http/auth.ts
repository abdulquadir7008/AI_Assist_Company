import { CompanyStatus, prisma, Role } from "@company-rag/database";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Principal } from "../access/policy.js";
import { verifyToken } from "../auth/tokens.js";
import { config } from "../config.js";

export class HttpError extends Error {
  constructor(
    public status: 401 | 403 | 404,
    message: string
  ) {
    super(message);
  }
}

/**
 * Identity comes from a Bearer JWT (typ "user" — root tokens are rejected),
 * but the user record — and therefore roles, department, and the company's
 * suspension state — is resolved from Postgres on EVERY request. Role
 * changes, suspension, and account deletion all take effect on the next
 * request with no cache.
 */
export const authenticate: RequestHandler = (request, response, next) => {
  void (async () => {
    const header = request.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    if (!token) {
      throw new HttpError(401, "Authentication required.");
    }

    let sub: string;
    try {
      ({ sub } = verifyToken(token, "user", config.auth.jwtSecret));
    } catch {
      throw new HttpError(401, "Invalid or expired session.");
    }

    const user = await prisma.user.findUnique({
      where: { id: sub },
      include: { company: true }
    });

    if (!user) {
      throw new HttpError(401, "Unknown user.");
    }
    if (user.company.status !== CompanyStatus.ACTIVE) {
      throw new HttpError(403, "This workspace is currently unavailable.");
    }

    const principal: Principal = {
      userId: user.id,
      companyId: user.companyId,
      roles: user.roles,
      department: user.department
    };
    response.locals.principal = principal;
    next();
  })().catch(next);
};

export function getPrincipal(response: Response): Principal {
  const principal = response.locals.principal as Principal | undefined;
  if (!principal) {
    throw new HttpError(401, "Authentication required.");
  }
  return principal;
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    try {
      const principal = getPrincipal(response);
      if (!principal.roles.some((role) => roles.includes(role))) {
        throw new HttpError(403, "You do not have permission to perform this action.");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
