-- Buy-side Q&A workflow: create the DataroomQuestion model and the polymorphic
-- DataroomQuestionAssignment (a question targets exactly one of link / group /
-- viewer / email), and expand Conversation (question link, origin, triage
-- metadata, recipient viewer) and Message (team-only internal notes).

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'visitor',
ADD COLUMN     "questionId" TEXT,
ADD COLUMN     "recipientViewerId" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "priority" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isInternalNote" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DataroomQuestion" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "priority" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unanswered',
    "orderIndex" INTEGER,
    "importBatchId" TEXT,
    "dataroomId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "dataroomDocumentId" TEXT,
    "documentPageNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataroomQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataroomQuestionAssignment" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "linkId" TEXT,
    "groupId" TEXT,
    "viewerId" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataroomQuestionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataroomQuestion_dataroomId_idx" ON "DataroomQuestion"("dataroomId");

-- CreateIndex
CREATE INDEX "DataroomQuestion_teamId_idx" ON "DataroomQuestion"("teamId");

-- CreateIndex
CREATE INDEX "DataroomQuestion_status_idx" ON "DataroomQuestion"("status");

-- CreateIndex
CREATE INDEX "DataroomQuestion_importBatchId_idx" ON "DataroomQuestion"("importBatchId");

-- CreateIndex
CREATE INDEX "DataroomQuestion_dataroomDocumentId_idx" ON "DataroomQuestion"("dataroomDocumentId");

-- CreateIndex
CREATE INDEX "DataroomQuestion_createdByUserId_idx" ON "DataroomQuestion"("createdByUserId");

-- CreateIndex
CREATE INDEX "DataroomQuestionAssignment_questionId_idx" ON "DataroomQuestionAssignment"("questionId");

-- CreateIndex
CREATE INDEX "DataroomQuestionAssignment_linkId_idx" ON "DataroomQuestionAssignment"("linkId");

-- CreateIndex
CREATE INDEX "DataroomQuestionAssignment_groupId_idx" ON "DataroomQuestionAssignment"("groupId");

-- CreateIndex
CREATE INDEX "DataroomQuestionAssignment_viewerId_idx" ON "DataroomQuestionAssignment"("viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "DataroomQuestionAssignment_questionId_linkId_key" ON "DataroomQuestionAssignment"("questionId", "linkId");

-- CreateIndex
CREATE UNIQUE INDEX "DataroomQuestionAssignment_questionId_groupId_key" ON "DataroomQuestionAssignment"("questionId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DataroomQuestionAssignment_questionId_viewerId_key" ON "DataroomQuestionAssignment"("questionId", "viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "DataroomQuestionAssignment_questionId_email_key" ON "DataroomQuestionAssignment"("questionId", "email");

-- CreateIndex
CREATE INDEX "Conversation_questionId_idx" ON "Conversation"("questionId");

-- CreateIndex
CREATE INDEX "Conversation_recipientViewerId_idx" ON "Conversation"("recipientViewerId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_questionId_recipientViewerId_key" ON "Conversation"("questionId", "recipientViewerId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "DataroomQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_recipientViewerId_fkey" FOREIGN KEY ("recipientViewerId") REFERENCES "Viewer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataroomQuestion" ADD CONSTRAINT "DataroomQuestion_dataroomId_fkey" FOREIGN KEY ("dataroomId") REFERENCES "Dataroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataroomQuestion" ADD CONSTRAINT "DataroomQuestion_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataroomQuestion" ADD CONSTRAINT "DataroomQuestion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataroomQuestion" ADD CONSTRAINT "DataroomQuestion_dataroomDocumentId_fkey" FOREIGN KEY ("dataroomDocumentId") REFERENCES "DataroomDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataroomQuestionAssignment" ADD CONSTRAINT "DataroomQuestionAssignment_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "DataroomQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataroomQuestionAssignment" ADD CONSTRAINT "DataroomQuestionAssignment_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataroomQuestionAssignment" ADD CONSTRAINT "DataroomQuestionAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ViewerGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataroomQuestionAssignment" ADD CONSTRAINT "DataroomQuestionAssignment_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "Viewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
