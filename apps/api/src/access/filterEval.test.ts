import { Department, Role } from "@company-rag/database";
import { describe, expect, it } from "vitest";
import { aclToChromaFlags, buildChromaAccessFilter, type Principal } from "./policy.js";

/**
 * Adversarial leak test. queryChunks passes buildChromaAccessFilter's output
 * directly to Chroma, so evaluating that filter against chunk metadata is
 * exactly the access decision Chroma makes inside the similarity search.
 * This evaluator mirrors Chroma's semantics for the subset we emit
 * ($and / $or / {field: {$eq}}), including: a missing metadata key never
 * matches. If the filter matches zero unauthorized fixtures here, no
 * unauthorized chunk can appear in retrieved results, sources, the prompt,
 * or audit logs.
 */
type Filter = Record<string, unknown>;

function matches(filter: Filter, metadata: Record<string, unknown>): boolean {
  if ("$and" in filter) {
    return (filter.$and as Filter[]).every((clause) => matches(clause, metadata));
  }
  if ("$or" in filter) {
    return (filter.$or as Filter[]).some((clause) => matches(clause, metadata));
  }
  const [key, condition] = Object.entries(filter)[0] as [string, { $eq: unknown }];
  if (!(key in metadata)) {
    return false; // Chroma: missing key never matches
  }
  return metadata[key] === condition.$eq;
}

const companyId = "acme";

function chunkMeta(acl: Parameters<typeof aclToChromaFlags>[0]): Record<string, unknown> {
  return { companyId, ...aclToChromaFlags(acl) };
}

const fixtures = {
  hrSalaryBands: chunkMeta({ allowedRoles: [Role.HR], allowedDepartments: [] }),
  legalContract: chunkMeta({ allowedRoles: [Role.LEGAL], allowedDepartments: [] }),
  engineeringDocs: chunkMeta({ allowedRoles: [], allowedDepartments: [Department.ENGINEERING] }),
  companyWide: chunkMeta({
    allowedRoles: [Role.HR, Role.LEGAL, Role.MANAGER, Role.EMPLOYEE, Role.CONTRACTOR],
    allowedDepartments: []
  }),
  adminOnlyUnclassified: chunkMeta({ allowedRoles: [], allowedDepartments: [] }),
  // Pre-RBAC chunk: citation metadata but NO acl_* keys at all.
  legacyChunk: { companyId, documentId: "old", title: "Legacy doc" },
  // Same-looking chunk from another tenant.
  otherCompanyHr: { ...chunkMeta({ allowedRoles: [Role.HR], allowedDepartments: [] }), companyId: "other" },
  // Chat upload: private to its uploader (owner lane), admin-only otherwise.
  chatUploadByU: chunkMeta({ allowedRoles: [], allowedDepartments: [], ownerId: "u" }),
  chatUploadByOther: chunkMeta({ allowedRoles: [], allowedDepartments: [], ownerId: "someone-else" })
};

function principal(roles: Role[], department: Department): Principal {
  return { userId: "u", companyId, roles, department };
}

function matchedBy(p: Principal): string[] {
  const filter = buildChromaAccessFilter(p);
  if (!filter) {
    return [];
  }
  return Object.entries(fixtures)
    .filter(([, metadata]) => matches(filter as Filter, metadata))
    .map(([name]) => name);
}

describe("adversarial: contractor probing for restricted content", () => {
  it("contractor retrieves ZERO chunks from HR/legal/engineering/admin/legacy fixtures", () => {
    const matched = matchedBy(principal([Role.CONTRACTOR], Department.GENERAL));
    expect(matched.sort()).toEqual(["chatUploadByU", "companyWide"]);
    expect(matched).not.toContain("hrSalaryBands");
    expect(matched).not.toContain("legalContract");
    expect(matched).not.toContain("adminOnlyUnclassified");
    expect(matched).not.toContain("legacyChunk");
    expect(matched).not.toContain("otherCompanyHr");
    expect(matched).not.toContain("chatUploadByOther");
  });

  it("employee in Engineering additionally reaches engineering department docs", () => {
    const matched = matchedBy(principal([Role.EMPLOYEE], Department.ENGINEERING));
    expect(matched.sort()).toEqual(["chatUploadByU", "companyWide", "engineeringDocs"]);
  });

  it("HR reaches HR content but not legal", () => {
    const matched = matchedBy(principal([Role.HR], Department.HR));
    expect(matched.sort()).toEqual(["chatUploadByU", "companyWide", "hrSalaryBands"]);
  });

  it("admin reaches everything in its own company only", () => {
    const matched = matchedBy(principal([Role.ADMIN], Department.LEADERSHIP));
    expect(matched.sort()).toEqual([
      "adminOnlyUnclassified",
      "chatUploadByOther",
      "chatUploadByU",
      "companyWide",
      "engineeringDocs",
      "hrSalaryBands",
      "legacyChunk",
      "legalContract"
    ]);
    expect(matched).not.toContain("otherCompanyHr");
  });

  it("owner lane: a user's own chat upload matches, everyone else's never does", () => {
    // Every non-admin role/department combination reaches its own upload
    // and never someone else's — the owner lane cannot be widened by roles.
    for (const role of [Role.HR, Role.LEGAL, Role.MANAGER, Role.EMPLOYEE, Role.CONTRACTOR]) {
      for (const department of Object.values(Department)) {
        const matched = matchedBy(principal([role], department));
        expect(matched).toContain("chatUploadByU");
        expect(matched).not.toContain("chatUploadByOther");
      }
    }
  });

  it("legacy chunks (no acl flags) fail closed for every non-admin role", () => {
    for (const role of [Role.HR, Role.LEGAL, Role.MANAGER, Role.EMPLOYEE, Role.CONTRACTOR]) {
      for (const department of Object.values(Department)) {
        expect(matchedBy(principal([role], department))).not.toContain("legacyChunk");
      }
    }
  });

  it("role changes apply immediately: contractor promoted to HR gains exactly HR access", () => {
    const before = matchedBy(principal([Role.CONTRACTOR], Department.GENERAL));
    const after = matchedBy(principal([Role.CONTRACTOR, Role.HR], Department.GENERAL));
    expect(before).not.toContain("hrSalaryBands");
    expect(after).toContain("hrSalaryBands");
    expect(after).not.toContain("legalContract");
  });
});
