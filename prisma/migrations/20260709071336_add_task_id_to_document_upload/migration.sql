-- AlterTable
ALTER TABLE "DocumentUpload" ADD COLUMN     "taskId" TEXT;

-- CreateIndex
CREATE INDEX "DocumentUpload_taskId_idx" ON "DocumentUpload"("taskId");

-- AddForeignKey
ALTER TABLE "DocumentUpload" ADD CONSTRAINT "DocumentUpload_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "uploadFolderId" TEXT;

-- CreateIndex
CREATE INDEX "Task_uploadFolderId_idx" ON "Task"("uploadFolderId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_uploadFolderId_fkey" FOREIGN KEY ("uploadFolderId") REFERENCES "DataroomFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
