-- CreateEnum
CREATE TYPE "Subject" AS ENUM ('biology', 'physics', 'chemistry', 'mathematics');

-- CreateEnum
CREATE TYPE "DifficultyLabel" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "QuestionRole" AS ENUM ('primary', 'backup');

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "subject" "Subject" NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subtopic" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Subtopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL,
    "subtopicId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "subtopicId" TEXT NOT NULL,
    "conceptTag" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "difficultyScore" INTEGER NOT NULL,
    "difficultyLabel" "DifficultyLabel" NOT NULL,
    "role" "QuestionRole" NOT NULL DEFAULT 'primary',
    "marks" INTEGER NOT NULL DEFAULT 1,
    "board" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'book_curated',
    "content" JSONB NOT NULL,
    "answer" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "sessionKey" TEXT,
    "subtopicId" TEXT NOT NULL,
    "chosenOptionIndex" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_subject_name_key" ON "Chapter"("subject", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Concept_subtopicId_tag_key" ON "Concept"("subtopicId", "tag");

-- CreateIndex
CREATE INDEX "Question_subtopicId_role_difficultyScore_idx" ON "Question"("subtopicId", "role", "difficultyScore");

-- CreateIndex
CREATE INDEX "Question_familyId_idx" ON "Question"("familyId");

-- CreateIndex
CREATE INDEX "Attempt_questionId_idx" ON "Attempt"("questionId");

-- CreateIndex
CREATE INDEX "Attempt_subtopicId_idx" ON "Attempt"("subtopicId");

-- CreateIndex
CREATE INDEX "Attempt_sessionKey_idx" ON "Attempt"("sessionKey");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subtopic" ADD CONSTRAINT "Subtopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
