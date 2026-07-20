import { Department, Role } from "@company-rag/database";
import type { Where } from "chromadb";

export type Principal = {
  userId: string;
  companyId: string;
  roles: Role[];
  department: Department;
};

export type Acl = {
  allowedRoles: Role[];
  allowedDepartments: Department[];
  /** Chat-upload owner: this user always retains access (owner lane). */
  ownerId?: string | null;
};

/**
 * The single access rule for the whole system. ADMIN sees everything;
 * otherwise access is the additive union of the user's roles, department,
 * and ownership (chat uploads stay readable by their uploader).
 * The REST layer calls this directly; the retrieval layer enforces the exact
 * same rule compiled to a Chroma where-filter by buildChromaAccessFilter.
 */
export function canAccess(
  principal: Pick<Principal, "userId" | "roles" | "department">,
  acl: Acl
): boolean {
  if (principal.roles.includes(Role.ADMIN)) {
    return true;
  }
  return (
    principal.roles.some((role) => acl.allowedRoles.includes(role)) ||
    acl.allowedDepartments.includes(principal.department) ||
    (acl.ownerId != null && acl.ownerId === principal.userId)
  );
}

/** Chunk-level override wins when set; otherwise the document ACL applies.
 * The owner lane is document-scoped and survives chunk overrides — an
 * uploader never loses access to part of their own file. */
export function effectiveChunkAcl(
  documentAcl: Acl,
  chunk: { aclOverride: boolean; overrideRoles: Role[]; overrideDepartments: Department[] }
): Acl {
  if (chunk.aclOverride) {
    return {
      allowedRoles: chunk.overrideRoles,
      allowedDepartments: chunk.overrideDepartments,
      ownerId: documentAcl.ownerId ?? null
    };
  }
  return documentAcl;
}

/**
 * Compile an ACL to the complete Chroma metadata flag set: one boolean per
 * role and department enum member, always present, explicitly true or false.
 * Writing every key (never omitting) makes reclassification-narrowing safe
 * regardless of whether the Chroma server merges or replaces metadata.
 * acl_role_ADMIN is always true: admins can access everything.
 */
export function aclToChromaFlags(acl: Acl): Record<string, boolean | string> {
  const flags: Record<string, boolean | string> = {};
  for (const role of Object.values(Role)) {
    flags[`acl_role_${role}`] = role === Role.ADMIN || acl.allowedRoles.includes(role);
  }
  for (const department of Object.values(Department)) {
    flags[`acl_dept_${department}`] = acl.allowedDepartments.includes(department);
  }
  // Owner lane. Chroma metadata cannot store null, so "no owner" is the empty
  // string — which can never equal a real userId in the $eq clause below.
  flags.owner_id = acl.ownerId ?? "";
  return flags;
}

/**
 * Compile the requesting user's permissions to a Chroma where-filter that is
 * applied INSIDE the similarity search — unauthorized chunks are never
 * retrieved, scored, or passed to the LLM.
 *
 * ADMIN: company scope only. Non-admin: company AND (any role flag OR the
 * department flag). Chunks without acl_* keys (pre-RBAC) never match a
 * non-admin filter — fail closed. Returns null for a principal with no roles;
 * callers must short-circuit to zero results.
 */
export function buildChromaAccessFilter(principal: Principal): Where | null {
  const companyClause: Where = { companyId: { $eq: principal.companyId } };

  if (principal.roles.includes(Role.ADMIN)) {
    return companyClause;
  }

  const grantClauses: Where[] = principal.roles.map((role) => ({
    [`acl_role_${role}`]: { $eq: true }
  }));
  grantClauses.push({ [`acl_dept_${principal.department}`]: { $eq: true } });
  // Owner lane: chat uploads always stay retrievable by their uploader.
  // Legacy chunks without owner_id can never match (missing key ≠ value).
  grantClauses.push({ owner_id: { $eq: principal.userId } });

  if (grantClauses.length === 0) {
    return null;
  }

  // Chroma rejects single-element $and/$or — unwrap when only one grant clause.
  const grant: Where = grantClauses.length === 1 ? grantClauses[0] : { $or: grantClauses };
  return { $and: [companyClause, grant] };
}
