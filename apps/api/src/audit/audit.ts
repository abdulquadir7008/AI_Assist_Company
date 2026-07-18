import { AuditAction, Prisma, prisma } from "@company-rag/database";
import type { Principal } from "../access/policy.js";

/**
 * Compliance trail: every query records who asked, with which roles, and
 * exactly which chunks were retrieved and cited; admin actions record
 * old/new state. Awaited so a failed write fails the request loudly rather
 * than silently losing the trail.
 */
export async function audit(
  principal: Principal,
  action: AuditAction,
  detail: Record<string, unknown>
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      companyId: principal.companyId,
      userId: principal.userId,
      rolesSnapshot: principal.roles,
      department: principal.department,
      action,
      detail: detail as Prisma.InputJsonValue
    }
  });
}

/**
 * Platform-level and pre-authentication events that still belong in a
 * company's trail: self-service register/verify (no principal exists yet)
 * and root-admin actions (suspend/activate, manual verify — recorded with
 * userId null and visible to that company's admins for transparency).
 */
export async function auditSystem(
  companyId: string,
  action: AuditAction,
  detail: Record<string, unknown>
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      companyId,
      userId: null,
      rolesSnapshot: [],
      department: null,
      action,
      detail: detail as Prisma.InputJsonValue
    }
  });
}
