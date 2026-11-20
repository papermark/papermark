-- CreateTable
CREATE TABLE "TaskList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER,
    "dataroomId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'TODO',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "category" TEXT,
    "dueDate" TIMESTAMP(3),
    "orderIndex" INTEGER,
    "taskListId" TEXT NOT NULL,
    "dataroomId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "viewerId" TEXT,
    "groupId" TEXT,
    "linkId" TEXT,
    "email" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "lastReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskActivity" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "comment" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "userId" TEXT,
    "viewerId" TEXT,
    "viewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskActivity_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Dataroom" ADD COLUMN "requestListEnabled" BOOLEAN NOT NULL DEFAULT false;


-- CreateIndex
CREATE INDEX "TaskList_dataroomId_idx" ON "TaskList"("dataroomId");

-- CreateIndex
CREATE INDEX "TaskList_teamId_idx" ON "TaskList"("teamId");

-- CreateIndex
CREATE INDEX "TaskList_dataroomId_orderIndex_idx" ON "TaskList"("dataroomId", "orderIndex");

-- CreateIndex
CREATE INDEX "Task_taskListId_idx" ON "Task"("taskListId");

-- CreateIndex
CREATE INDEX "Task_dataroomId_idx" ON "Task"("dataroomId");

-- CreateIndex
CREATE INDEX "Task_teamId_idx" ON "Task"("teamId");

-- CreateIndex
CREATE INDEX "Task_taskListId_orderIndex_idx" ON "Task"("taskListId", "orderIndex");

-- CreateIndex
CREATE INDEX "TaskAssignment_taskId_idx" ON "TaskAssignment"("taskId");

-- CreateIndex
CREATE INDEX "TaskAssignment_viewerId_idx" ON "TaskAssignment"("viewerId");

-- CreateIndex
CREATE INDEX "TaskAssignment_groupId_idx" ON "TaskAssignment"("groupId");

-- CreateIndex
CREATE INDEX "TaskAssignment_linkId_idx" ON "TaskAssignment"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_viewerId_key" ON "TaskAssignment"("taskId", "viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_groupId_key" ON "TaskAssignment"("taskId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_linkId_key" ON "TaskAssignment"("taskId", "linkId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_email_key" ON "TaskAssignment"("taskId", "email");

-- CreateIndex
CREATE INDEX "TaskActivity_taskId_idx" ON "TaskActivity"("taskId");

-- CreateIndex
CREATE INDEX "TaskActivity_userId_idx" ON "TaskActivity"("userId");

-- CreateIndex
CREATE INDEX "TaskActivity_viewerId_idx" ON "TaskActivity"("viewerId");

-- CreateIndex
CREATE INDEX "TaskActivity_viewId_idx" ON "TaskActivity"("viewId");

-- CreateIndex
CREATE INDEX "TaskActivity_taskId_createdAt_idx" ON "TaskActivity"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskList" ADD CONSTRAINT "TaskList_dataroomId_fkey" FOREIGN KEY ("dataroomId") REFERENCES "Dataroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskList" ADD CONSTRAINT "TaskList_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_taskListId_fkey" FOREIGN KEY ("taskListId") REFERENCES "TaskList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_dataroomId_fkey" FOREIGN KEY ("dataroomId") REFERENCES "Dataroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "Viewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ViewerGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "Viewer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "View"("id") ON DELETE SET NULL ON UPDATE CASCADE;
