-- Pre-condition (checked manually before this migration was authored):
--   SELECT email, count(*) FROM "User" GROUP BY email HAVING count(*) > 1;
-- must return zero rows — the global unique index below fails loudly otherwise.

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'REGISTER';
ALTER TYPE "AuditAction" ADD VALUE 'VERIFY_EMAIL';
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN';
ALTER TYPE "AuditAction" ADD VALUE 'USER_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_CHANGE';
ALTER TYPE "AuditAction" ADD VALUE 'COMPANY_STATUS_CHANGE';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "status" "CompanyStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION';

-- Companies that existed before onboarding were already operational — keep them usable.
UPDATE "Company" SET "status" = 'ACTIVE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordHash" TEXT;

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RootAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RootAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationCode_userId_idx" ON "VerificationCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RootAdmin_email_key" ON "RootAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
