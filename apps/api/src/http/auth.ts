import { prisma, Role } from "@company-rag/database";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Principal } from "../access/policy.js";

export class HttpError extends Error {
  constructor(
    public status: 401 | 403 | 404,
    message: string
  ) {
    super(message);
  }
}

/**
 * Identity slice: the user id arrives in headers (no login yet), but the user
 * record — and therefore roles and department — is resolved from Postgres on
 * EVERY request. Roles are never trusted from the client, and role changes
 * (promotion, termination) take effect on the next request with no cache.
 * Swapping to JWT/SSO later only changes how userId is derived here.
 */
export const authenticate: RequestHandler = (request, response, next) => {
  void (async () => {
    const companyId = request.header("x-company-id");
    const userId = request.header("x-user-id");

    if (!companyId || !userId) {
      throw new HttpError(401, "Authentication required.");
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, companyId }
    });

    if (!user) {
      throw new HttpError(401, "Unknown user.");
    }

    const principal: Principal = {
      userId: user.id,
      companyId,
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
