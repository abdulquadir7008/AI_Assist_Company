-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'HR', 'LEGAL', 'MANAGER', 'EMPLOYEE', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "Department" AS ENUM ('GENERAL', 'ENGINEERING', 'HR', 'LEGAL', 'SALES', 'SUPPORT', 'LEADERSHIP');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('ASK', 'DOC_UPLOAD', 'DOC_DOWNLOAD', 'ROLE_CHANGE', 'RECLASSIFY', 'CHUNK_RECLASSIFY');

-- AlterTable: documents fail closed — unclassified docs are admin-only
ALTER TABLE "Document" ADD COLUMN     "allowedDepartments" "Department"[] DEFAULT ARRAY[]::"Department"[],
ADD COLUMN     "allowedRoles" "Role"[] DEFAULT ARRAY['ADMIN']::"Role"[],
ADD COLUMN     "classifiedAt" TIMESTAMP(3),
ADD COLUMN     "classifiedById" TEXT;

-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN     "aclOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overrideDepartments" "Department"[] DEFAULT ARRAY[]::"Department"[],
ADD COLUMN     "overrideRoles" "Role"[] DEFAULT ARRAY[]::"Role"[];

-- AlterTable: add new columns first, backfill from legacy string role, then drop it
ALTER TABLE "User" ADD COLUMN     "department" "Department" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "roles" "Role"[] DEFAULT ARRAY['EMPLOYEE']::"Role"[];

UPDATE "User" SET "roles" = CASE lower("role")
  WHEN 'admin' THEN ARRAY['ADMIN']::"Role"[]
  WHEN 'hr' THEN ARRAY['HR']::"Role"[]
  WHEN 'legal' THEN ARRAY['LEGAL']::"Role"[]
  WHEN 'manager' THEN ARRAY['MANAGER']::"Role"[]
  WHEN 'contractor' THEN ARRAY['CONTRACTOR']::"Role"[]
  ELSE ARRAY['EMPLOYEE']::"Role"[]
END;

ALTER TABLE "User" DROP COLUMN "role";

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "rolesSnapshot" "Role"[],
    "department" "Department",
    "action" "AuditAction" NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
