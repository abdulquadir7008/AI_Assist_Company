import { Department, Role } from "@company-rag/database";
import { describe, expect, it } from "vitest";
import {
  aclToChromaFlags,
  buildChromaAccessFilter,
  canAccess,
  effectiveChunkAcl,
  type Acl,
  type Principal
} from "./policy.js";

const hrOnly: Acl = { allowedRoles: [Role.HR], allowedDepartments: [] };
const legalAndHr: Acl = { allowedRoles: [Role.LEGAL, Role.HR], allowedDepartments: [] };
const engineeringDeptOnly: Acl = { allowedRoles: [], allowedDepartments: [Department.ENGINEERING] };
const adminOnly: Acl = { allowedRoles: [Role.ADMIN], allowedDepartments: [] };
const openToAll: Acl = {
  allowedRoles: Object.values(Role),
  allowedDepartments: Object.values(Department)
};
const ownedByU9: Acl = { allowedRoles: [Role.ADMIN], allowedDepartments: [], ownerId: "u9" };

function principal(roles: Role[], department: Department = Department.GENERAL): Principal {
  return { userId: "u1", companyId: "c1", roles, department };
}

describe("canAccess", () => {
  it("ADMIN can access everything, including admin-only and empty ACLs", () => {
    for (const acl of [hrOnly, legalAndHr, engineeringDeptOnly, adminOnly, openToAll, ownedByU9]) {
      expect(canAccess(principal([Role.ADMIN]), acl)).toBe(true);
    }
  });

  it("role must intersect the allowed roles", () => {
    expect(canAccess(principal([Role.HR]), hrOnly)).toBe(true);
    expect(canAccess(principal([Role.LEGAL]), hrOnly)).toBe(false);
    expect(canAccess(principal([Role.CONTRACTOR]), hrOnly)).toBe(false);
    expect(canAccess(principal([Role.EMPLOYEE]), legalAndHr)).toBe(false);
  });

  it("contractor cannot access legal/HR/admin-restricted content", () => {
    for (const acl of [hrOnly, legalAndHr, adminOnly, engineeringDeptOnly]) {
      expect(canAccess(principal([Role.CONTRACTOR]), acl)).toBe(false);
    }
  });

  it("department membership grants access independently of roles", () => {
    expect(canAccess(principal([Role.CONTRACTOR], Department.ENGINEERING), engineeringDeptOnly)).toBe(true);
    expect(canAccess(principal([], Department.ENGINEERING), engineeringDeptOnly)).toBe(true);
    expect(canAccess(principal([Role.EMPLOYEE], Department.SALES), engineeringDeptOnly)).toBe(false);
  });

  it("multi-role access is the additive union", () => {
    expect(canAccess(principal([Role.CONTRACTOR, Role.HR]), hrOnly)).toBe(true);
    expect(canAccess(principal([Role.MANAGER, Role.LEGAL]), legalAndHr)).toBe(true);
  });

  it("a user with no roles and no matching department is denied", () => {
    expect(canAccess(principal([]), hrOnly)).toBe(false);
    expect(canAccess(principal([]), adminOnly)).toBe(false);
  });

  it("owner lane: the uploader keeps access to an otherwise admin-only doc", () => {
    const owner: Principal = { userId: "u9", companyId: "c1", roles: [Role.CONTRACTOR], department: Department.GENERAL };
    expect(canAccess(owner, ownedByU9)).toBe(true);
  });

  it("owner lane: any other non-admin user is still denied", () => {
    expect(canAccess(principal([Role.EMPLOYEE]), ownedByU9)).toBe(false);
    expect(canAccess(principal([Role.CONTRACTOR]), ownedByU9)).toBe(false);
  });

  it("owner lane: null/absent ownerId grants nothing", () => {
    expect(canAccess(principal([Role.EMPLOYEE]), { ...hrOnly, ownerId: null })).toBe(false);
    // An empty-string ownerId (Chroma's null encoding) must never match either.
    const emptyOwner: Principal = { userId: "", companyId: "c1", roles: [], department: Department.GENERAL };
    expect(canAccess(emptyOwner, { allowedRoles: [], allowedDepartments: [], ownerId: null })).toBe(false);
  });
});

describe("effectiveChunkAcl", () => {
  it("inherits the document ACL when no override", () => {
    const acl = effectiveChunkAcl(hrOnly, {
      aclOverride: false,
      overrideRoles: [Role.CONTRACTOR],
      overrideDepartments: []
    });
    expect(acl).toEqual(hrOnly);
  });

  it("override wins, including narrowing to nobody", () => {
    const narrowed = effectiveChunkAcl(openToAll, {
      aclOverride: true,
      overrideRoles: [],
      overrideDepartments: []
    });
    expect(narrowed).toEqual({ allowedRoles: [], allowedDepartments: [], ownerId: null });
    expect(canAccess(principal([Role.EMPLOYEE]), narrowed)).toBe(false);
    expect(canAccess(principal([Role.ADMIN]), narrowed)).toBe(true);
  });

  it("the owner lane survives a chunk override", () => {
    const overridden = effectiveChunkAcl(ownedByU9, {
      aclOverride: true,
      overrideRoles: [],
      overrideDepartments: []
    });
    expect(overridden.ownerId).toBe("u9");
    const owner: Principal = { userId: "u9", companyId: "c1", roles: [Role.EMPLOYEE], department: Department.GENERAL };
    expect(canAccess(owner, overridden)).toBe(true);
  });
});

describe("aclToChromaFlags", () => {
  it("emits an explicit boolean for EVERY role and department", () => {
    const flags = aclToChromaFlags(hrOnly);
    for (const role of Object.values(Role)) {
      expect(flags[`acl_role_${role}`]).toBe(role === Role.HR || role === Role.ADMIN);
    }
    for (const department of Object.values(Department)) {
      expect(flags[`acl_dept_${department}`]).toBe(false);
    }
  });

  it("acl_role_ADMIN is always true even for an empty ACL", () => {
    const flags = aclToChromaFlags({ allowedRoles: [], allowedDepartments: [] });
    expect(flags.acl_role_ADMIN).toBe(true);
    const denied = Object.entries(flags).filter(
      ([key]) => key !== "acl_role_ADMIN" && key !== "owner_id"
    );
    expect(denied.every(([, value]) => value === false)).toBe(true);
  });

  it("owner_id is always present: the uploader id, or empty string for no owner", () => {
    expect(aclToChromaFlags(ownedByU9).owner_id).toBe("u9");
    expect(aclToChromaFlags(hrOnly).owner_id).toBe("");
  });
});

describe("buildChromaAccessFilter", () => {
  it("admin gets a bare company filter (sees everything in the company)", () => {
    expect(buildChromaAccessFilter(principal([Role.ADMIN]))).toEqual({
      companyId: { $eq: "c1" }
    });
  });

  it("contractor filter contains exactly its role flag, department flag, and owner lane", () => {
    const filter = buildChromaAccessFilter(principal([Role.CONTRACTOR], Department.GENERAL));
    expect(filter).toEqual({
      $and: [
        { companyId: { $eq: "c1" } },
        {
          $or: [
            { acl_role_CONTRACTOR: { $eq: true } },
            { acl_dept_GENERAL: { $eq: true } },
            { owner_id: { $eq: "u1" } }
          ]
        }
      ]
    });
  });

  it("a role-less user still gets department + owner clauses", () => {
    const filter = buildChromaAccessFilter(principal([], Department.SALES));
    expect(filter).toEqual({
      $and: [
        { companyId: { $eq: "c1" } },
        { $or: [{ acl_dept_SALES: { $eq: true } }, { owner_id: { $eq: "u1" } }] }
      ]
    });
  });

  it("multi-role user gets one clause per role plus department and owner", () => {
    const filter = buildChromaAccessFilter(principal([Role.HR, Role.MANAGER], Department.HR));
    expect(filter).toEqual({
      $and: [
        { companyId: { $eq: "c1" } },
        {
          $or: [
            { acl_role_HR: { $eq: true } },
            { acl_role_MANAGER: { $eq: true } },
            { acl_dept_HR: { $eq: true } },
            { owner_id: { $eq: "u1" } }
          ]
        }
      ]
    });
  });
});
