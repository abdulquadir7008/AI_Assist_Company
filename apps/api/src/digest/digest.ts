import { prisma } from "@company-rag/database";
import {
  AuditAction,
  Department,
  DocumentStatus,
  Role
} from "@company-rag/database";
import { canAccess } from "../access/policy.js";
import { auditSystem } from "../audit/audit.js";
import { sendMail } from "../email/mailer.js";

export type DigestDocument = {
  id: string;
  title: string;
  category: string;
  allowedRoles: Role[];
  allowedDepartments: Department[];
  ownerId: string | null;
  isNew: boolean;
};

/** True when a document's ACL grants at least one non-admin role/department. */
export function isBroadlyVisible(document: {
  allowedRoles: Role[];
  allowedDepartments: Department[];
}): boolean {
  return (
    document.allowedRoles.some((role) => role !== Role.ADMIN) ||
    document.allowedDepartments.length > 0
  );
}

export function formatDigestEmail(input: {
  userName: string | null;
  companyName: string;
  documents: DigestDocument[];
  webUrl: string;
}): { subject: string; text: string } {
  const count = input.documents.length;
  const noun = count === 1 ? "policy/document" : "policies/documents";
  const subject = `${count} ${noun} changed this week at ${input.companyName}`;

  const lines = input.documents.map(
    (document) =>
      `  • ${document.title} (${document.category.replace("_", " ")}) — ${document.isNew ? "new" : "access updated"}`
  );

  const text = [
    `Hi ${input.userName ?? "there"},`,
    "",
    `${count} ${noun} relevant to you ${count === 1 ? "was" : "were"} added or updated this week:`,
    "",
    ...lines,
    "",
    `Ask the assistant about any of them: ${input.webUrl}`,
    "",
    "— Your company assistant (you receive this because document access relevant to your role changed)"
  ].join("\n");

  return { subject, text };
}

export function formatSlackMessage(input: {
  companyName: string;
  documents: DigestDocument[];
  webUrl: string;
}): { text: string } {
  const count = input.documents.length;
  const lines = input.documents.map(
    (document) =>
      `• *${document.title}* (${document.category.replace("_", " ")}) — ${document.isNew ? "new" : "access updated"}`
  );
  return {
    text: [
      `:page_facing_up: *${count} ${count === 1 ? "document" : "documents"} changed this week* at ${input.companyName}`,
      ...lines,
      `Ask the assistant: ${input.webUrl}`
    ].join("\n")
  };
}

export type DigestResult = {
  documentCount: number;
  emailsSent: number;
  emailsSkipped: number;
  slackSent: boolean;
};

/**
 * Build and deliver one company's digest for [periodStart, periodEnd).
 *
 * Access rules apply per channel:
 * - Emails are personal: each recipient only sees documents `canAccess`
 *   grants them. Users with zero relevant changes get no email at all.
 * - Slack posts to a shared channel, so it only ever lists documents whose
 *   ACL grants at least one non-admin role/department (nothing restricted,
 *   nothing owner-private).
 */
export async function runDigestForCompany(
  companyId: string,
  periodStart: Date,
  periodEnd: Date,
  webUrl: string
): Promise<DigestResult> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  const changed = await prisma.document.findMany({
    where: {
      companyId,
      status: DocumentStatus.READY,
      OR: [
        { createdAt: { gte: periodStart, lt: periodEnd } },
        { classifiedAt: { gte: periodStart, lt: periodEnd } }
      ]
    },
    orderBy: { createdAt: "desc" }
  });

  const documents: DigestDocument[] = changed.map((document) => ({
    id: document.id,
    title: document.title,
    category: document.category,
    allowedRoles: document.allowedRoles,
    allowedDepartments: document.allowedDepartments,
    ownerId: document.ownerId,
    isNew: document.createdAt >= periodStart
  }));

  let emailsSent = 0;
  let emailsSkipped = 0;
  let slackSent = false;

  if (documents.length > 0 && company.digestsEnabled) {
    const users = await prisma.user.findMany({
      where: { companyId, emailVerifiedAt: { not: null }, digestOptOut: false }
    });

    for (const user of users) {
      const visible = documents.filter((document) =>
        canAccess(
          { userId: user.id, roles: user.roles, department: user.department },
          document
        )
      );
      if (visible.length === 0) {
        emailsSkipped += 1;
        continue;
      }
      const mail = formatDigestEmail({
        userName: user.name,
        companyName: company.name,
        documents: visible,
        webUrl
      });
      try {
        await sendMail({ to: user.email, subject: mail.subject, text: mail.text });
        emailsSent += 1;
      } catch (error) {
        console.error(`[digest] email to ${user.email} failed:`, error);
        emailsSkipped += 1;
      }
    }

    const broadly = documents.filter(isBroadlyVisible);
    if (company.slackWebhookUrl && broadly.length > 0) {
      try {
        const response = await fetch(company.slackWebhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            formatSlackMessage({ companyName: company.name, documents: broadly, webUrl })
          )
        });
        slackSent = response.ok;
        if (!response.ok) {
          console.error(`[digest] Slack webhook returned ${response.status}`);
        }
      } catch (error) {
        console.error("[digest] Slack webhook failed:", error);
      }
    }
  }

  await prisma.digestRun.create({
    data: {
      companyId,
      periodStart,
      periodEnd,
      documentCount: documents.length,
      emailsSent,
      slackSent
    }
  });

  await auditSystem(companyId, AuditAction.DIGEST_SENT, {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    documentCount: documents.length,
    emailsSent,
    emailsSkipped,
    slackSent
  });

  return { documentCount: documents.length, emailsSent, emailsSkipped, slackSent };
}
