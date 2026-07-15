import type { Request } from "express";

export function getRequestContext(request: Request) {
  const companyId = request.header("x-company-id");
  const userId = request.header("x-user-id") || undefined;

  if (!companyId) {
    throw new Error("Missing x-company-id header.");
  }

  return { companyId, userId };
}
