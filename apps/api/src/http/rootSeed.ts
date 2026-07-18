import { prisma } from "@company-rag/database";
import { hashPassword } from "../auth/passwords.js";
import { config } from "../config.js";

/**
 * Seed (or rotate) the root admin from env at boot. Upserting the hash means
 * changing ROOT_ADMIN_PASSWORD in the environment rotates the credential on
 * the next restart. Without both vars, the root dashboard is simply disabled.
 */
export async function seedRootAdmin(): Promise<void> {
  const { email, password } = config.rootAdmin;
  if (!email || !password) {
    console.warn("[root] ROOT_ADMIN_EMAIL/ROOT_ADMIN_PASSWORD not set — root dashboard disabled.");
    return;
  }

  const passwordHash = await hashPassword(password);
  await prisma.rootAdmin.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash },
    create: { email: email.toLowerCase(), passwordHash }
  });
  console.log(`[root] root admin ready: ${email.toLowerCase()}`);
}
