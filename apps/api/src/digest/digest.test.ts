import { Department, Role } from "@company-rag/database";
import { describe, expect, it } from "vitest";
import { formatDigestEmail, formatSlackMessage, isBroadlyVisible, type DigestDocument } from "./digest.js";

const hrDoc: DigestDocument = {
  id: "d1",
  title: "Compensation & Severance Policy",
  category: "HR_POLICY",
  allowedRoles: [Role.HR, Role.LEGAL],
  allowedDepartments: [],
  ownerId: null,
  isNew: true
};

const adminOnlyDoc: DigestDocument = {
  id: "d2",
  title: "Board Minutes",
  category: "LEGAL",
  allowedRoles: [Role.ADMIN],
  allowedDepartments: [],
  ownerId: null,
  isNew: false
};

const chatUpload: DigestDocument = {
  id: "d3",
  title: "My scratch notes",
  category: "OTHER",
  allowedRoles: [Role.ADMIN],
  allowedDepartments: [],
  ownerId: "u9",
  isNew: true
};

const deptDoc: DigestDocument = {
  id: "d4",
  title: "Engineering Runbook",
  category: "TECHNICAL",
  allowedRoles: [Role.ADMIN],
  allowedDepartments: [Department.ENGINEERING],
  ownerId: null,
  isNew: true
};

describe("isBroadlyVisible (Slack gate)", () => {
  it("allows docs granting a non-admin role or any department", () => {
    expect(isBroadlyVisible(hrDoc)).toBe(true);
    expect(isBroadlyVisible(deptDoc)).toBe(true);
  });

  it("blocks admin-only and owner-private docs from the shared channel", () => {
    expect(isBroadlyVisible(adminOnlyDoc)).toBe(false);
    expect(isBroadlyVisible(chatUpload)).toBe(false);
  });
});

describe("formatDigestEmail", () => {
  it("leads with the count and lists each document with its change type", () => {
    const mail = formatDigestEmail({
      userName: "Hana",
      companyName: "Acme",
      documents: [hrDoc, adminOnlyDoc],
      webUrl: "http://localhost:3000"
    });
    expect(mail.subject).toBe("2 policies/documents changed this week at Acme");
    expect(mail.text).toContain("Hi Hana,");
    expect(mail.text).toContain("Compensation & Severance Policy (HR POLICY) — new");
    expect(mail.text).toContain("Board Minutes (LEGAL) — access updated");
    expect(mail.text).toContain("http://localhost:3000");
  });

  it("uses singular phrasing for one document", () => {
    const mail = formatDigestEmail({
      userName: null,
      companyName: "Acme",
      documents: [hrDoc],
      webUrl: "http://x"
    });
    expect(mail.subject).toContain("1 policy/document changed");
    expect(mail.text).toContain("Hi there,");
  });
});

describe("formatSlackMessage", () => {
  it("formats a compact bulleted message", () => {
    const message = formatSlackMessage({
      companyName: "Acme",
      documents: [hrDoc, deptDoc],
      webUrl: "http://localhost:3000"
    });
    expect(message.text).toContain("*2 documents changed this week*");
    expect(message.text).toContain("*Compensation & Severance Policy*");
    expect(message.text).toContain("*Engineering Runbook*");
  });
});
