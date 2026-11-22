-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "submissionId" TEXT;

-- CreateIndex
CREATE INDEX "Attempt_submissionId_idx" ON "Attempt"("submissionId");
