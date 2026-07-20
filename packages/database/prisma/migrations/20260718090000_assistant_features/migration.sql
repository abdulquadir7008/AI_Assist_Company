-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('ADMIN', 'CHAT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CHAT_UPLOAD';
ALTER TYPE "AuditAction" ADD VALUE 'DIGEST_SENT';
ALTER TYPE "AuditAction" ADD VALUE 'CONVERSATION_DELETE';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "digestsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slackWebhookUrl" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "source" "DocumentSource" NOT NULL DEFAULT 'ADMIN';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "conversationId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "documentCount" INTEGER NOT NULL,
    "emailsSent" INTEGER NOT NULL,
    "slackSent" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_companyId_userId_updatedAt_idx" ON "Conversation"("companyId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "DigestRun_companyId_periodEnd_idx" ON "DigestRun"("companyId", "periodEnd");

-- CreateIndex
CREATE INDEX "Question_conversationId_idx" ON "Question"("conversationId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestRun" ADD CONSTRAINT "DigestRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

