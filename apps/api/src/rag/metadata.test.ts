import { Department, Role } from "@company-rag/database";
import { describe, expect, it } from "vitest";
import { effectiveChunkAcl } from "../access/policy.js";
import { buildChunkMetadata } from "./metadata.js";

const document = {
  id: "doc1",
  companyId: "acme",
  title: "Employee Handbook",
  originalName: "Employee Handbook 2026.pdf",
  mimeType: "application/pdf",
  category: "HR_POLICY",
  updatedAt: new Date("2026-01-05T00:00:00.000Z")
};

const chunk = { id: "chunk1", section: "4.2 Remote Work", pageStart: 12, pageEnd: 12 };

describe("buildChunkMetadata", () => {
  it("fail-closed ingest: an unclassified ACL yields admin-only flags", () => {
    const metadata = buildChunkMetadata(document, chunk, {
      allowedRoles: [Role.ADMIN],
      allowedDepartments: []
    });

    expect(metadata.acl_role_ADMIN).toBe(true);
    for (const role of Object.values(Role).filter((item) => item !== Role.ADMIN)) {
      expect(metadata[`acl_role_${role}`]).toBe(false);
    }
    for (const department of Object.values(Department)) {
      expect(metadata[`acl_dept_${department}`]).toBe(false);
    }
  });

  it("keeps all citation fields and omits null ones", () => {
    const metadata = buildChunkMetadata(document, { id: "c2" }, {
      allowedRoles: [Role.HR],
      allowedDepartments: [Department.HR]
    });

    expect(metadata).toMatchObject({
      companyId: "acme",
      documentId: "doc1",
      chunkId: "c2",
      title: "Employee Handbook",
      documentName: "Employee Handbook 2026.pdf",
      fileType: "application/pdf",
      docUpdatedAt: "2026-01-05T00:00:00.000Z",
      acl_role_HR: true,
      acl_dept_HR: true
    });
    expect("section" in metadata).toBe(false);
    expect("pageStart" in metadata).toBe(false);
    // No nulls anywhere — Chroma rejects them.
    expect(Object.values(metadata).every((value) => value !== null && value !== undefined)).toBe(true);
  });

  it("reflects a chunk-level override narrowing a permissive document", () => {
    const docAcl = { allowedRoles: [Role.EMPLOYEE, Role.HR], allowedDepartments: [] };
    const overridden = effectiveChunkAcl(docAcl, {
      aclOverride: true,
      overrideRoles: [Role.HR],
      overrideDepartments: []
    });
    const metadata = buildChunkMetadata(document, chunk, overridden);

    expect(metadata.acl_role_HR).toBe(true);
    expect(metadata.acl_role_EMPLOYEE).toBe(false);
  });

  it("writes the owner lane: uploader id, or empty string when unowned", () => {
    const owned = buildChunkMetadata(document, chunk, {
      allowedRoles: [Role.ADMIN],
      allowedDepartments: [],
      ownerId: "u9"
    });
    expect(owned.owner_id).toBe("u9");

    const unowned = buildChunkMetadata(document, chunk, {
      allowedRoles: [Role.HR],
      allowedDepartments: []
    });
    expect(unowned.owner_id).toBe("");
  });
});
