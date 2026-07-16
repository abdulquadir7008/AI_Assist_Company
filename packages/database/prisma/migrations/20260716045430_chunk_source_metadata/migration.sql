-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN     "pageEnd" INTEGER,
ADD COLUMN     "pageStart" INTEGER,
ADD COLUMN     "section" TEXT;
