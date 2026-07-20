import { prisma } from "@company-rag/database";
import { CompanyStatus } from "@company-rag/database";
import { config } from "../config.js";
import { runDigestForCompany } from "./digest.js";

/** Monday 00:00 of the week containing `date` (server timezone). */
export function weekStart(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  // getDay(): 0=Sunday … 6=Saturday. Shift back to Monday.
  const shift = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - shift);
  return start;
}

/**
 * Weekly digests: fire on Mondays at/after 09:00 for the PREVIOUS week,
 * once per company (deduped via DigestRun rows). The check runs hourly, so
 * a restart never skips a week — it just sends on the next hourly tick.
 */
export async function digestTick(now = new Date()): Promise<void> {
  if (now.getDay() !== 1 || now.getHours() < 9) {
    return;
  }

  const periodEnd = weekStart(now); // this Monday 00:00
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  const companies = await prisma.company.findMany({
    where: { status: CompanyStatus.ACTIVE, digestsEnabled: true },
    select: { id: true }
  });

  for (const company of companies) {
    const alreadySent = await prisma.digestRun.findFirst({
      where: { companyId: company.id, periodEnd: { gte: periodEnd } }
    });
    if (alreadySent) {
      continue;
    }
    try {
      await runDigestForCompany(company.id, periodStart, periodEnd, config.webUrl);
    } catch (error) {
      console.error(`[digest] weekly run failed for company ${company.id}:`, error);
    }
  }
}

export function startDigestScheduler(): NodeJS.Timeout | null {
  if (config.disableDigestScheduler) {
    console.log("[digest] scheduler disabled (DISABLE_DIGEST_SCHEDULER=true)");
    return null;
  }
  const HOUR = 60 * 60 * 1000;
  const timer = setInterval(() => {
    void digestTick().catch((error) => console.error("[digest] tick failed:", error));
  }, HOUR);
  // Also check shortly after boot so a Monday restart still delivers.
  setTimeout(() => {
    void digestTick().catch((error) => console.error("[digest] boot tick failed:", error));
  }, 30 * 1000);
  console.log("[digest] weekly scheduler started (Mondays ≥ 09:00 server time)");
  return timer;
}
