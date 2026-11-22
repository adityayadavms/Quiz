import { prisma } from "../db.js";
import { randomUUID } from "node:crypto";
// ── Shared safe projection. NEVER add `answer` here. ──
export const SELECT_SAFE = {
  id: true,
  conceptTag: true,
  familyId: true,
  role: true,
  difficultyScore: true,
  difficultyLabel: true,
  marks: true,
  content: true,
} as const;

// cuid shape check (cuid2 / cuid both start with c and are 24-32 chars alnum)
export const CUID_RE = /^c[0-9a-z]{23,31}$/i;

export const PRIMARY_COUNT = 6;
export const BACKUP_COUNT = 3;

// Typed domain errors — the controller maps these to HTTP.
export class QuizError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/pool — load the 9-question pool for a subtopic
// ─────────────────────────────────────────────────────────────
export async function getPoolForSubtopic(subtopicId: string) {
  const subtopic = await prisma.subtopic.findUnique({ where: { id: subtopicId } });
  if (!subtopic) {
    throw new QuizError("SUBTOPIC_NOT_FOUND", "Subtopic not found", 404);
  }

  const [primary, backup] = await Promise.all([
    prisma.question.findMany({
      where: { subtopicId, role: "primary" },
      select: SELECT_SAFE,
      orderBy: { difficultyScore: "asc" }, // gentle easy → hard ramp
      take: PRIMARY_COUNT,
    }),
    prisma.question.findMany({
      where: { subtopicId, role: "backup" },
      select: SELECT_SAFE,
      take: BACKUP_COUNT,
    }),
  ]);

  if (primary.length < PRIMARY_COUNT) {
    throw new QuizError(
      "INSUFFICIENT_PRIMARIES",
      `Subtopic has only ${primary.length} primary questions; need ${PRIMARY_COUNT}`,
      409
    );
  }

  return { subtopicId, primary, backup };
}



// ─────────────────────────────────────────────────────────────
// POST /api/submit — grade a whole batch at once
// ─────────────────────────────────────────────────────────────
export type SubmittedAnswer = { questionId: string; chosenOptionIndex: number };

export type SubmitResultItem = {
  questionId: string;
  chosenOptionIndex: number;
  isCorrect: boolean;
  correctOptionIndex: number;
  explanation: string;
};

export async function gradeSubmission(input: {
  subtopicId: string;
  sessionKey?: string | null;
  answers: SubmittedAnswer[];
}) {
  const { subtopicId, sessionKey, answers } = input;

  if (answers.length === 0) {
    throw new QuizError("EMPTY_ANSWERS", "answers must contain at least one item", 400);
  }

  const ids = answers.map((a) => a.questionId);
  if (new Set(ids).size !== ids.length) {
    throw new QuizError("DUPLICATE_QUESTION_ID", "answers contain duplicate questionId", 400);
  }

  const subtopic = await prisma.subtopic.findUnique({ where: { id: subtopicId } });
  if (!subtopic) {
    throw new QuizError("SUBTOPIC_NOT_FOUND", "Subtopic not found", 404);
  }

  const questions = await prisma.question.findMany({
    where: { id: { in: ids }, subtopicId },
    select: { id: true, answer: true, content: true },
  });

  if (questions.length !== ids.length) {
    throw new QuizError(
      "QUESTION_NOT_IN_SUBTOPIC",
      "One or more questionIds do not exist in this subtopic",
      404
    );
  }

  const byId = new Map(questions.map((q) => [q.id, q]));

  const results: SubmitResultItem[] = answers.map((a) => {
    const q = byId.get(a.questionId)!;
    const answer  = q.answer  as { correctOptionIndex: number; explanation: string };
    const content = q.content as { options: string[] };

    if (a.chosenOptionIndex < 0 || a.chosenOptionIndex >= content.options.length) {
      throw new QuizError(
        "INDEX_OUT_OF_RANGE",
        `chosenOptionIndex out of range for question ${a.questionId}`,
        400
      );
    }

    return {
      questionId: a.questionId,
      chosenOptionIndex: a.chosenOptionIndex,
      isCorrect: a.chosenOptionIndex === answer.correctOptionIndex,
      correctOptionIndex: answer.correctOptionIndex,
      explanation: answer.explanation,
    };
  });

  const submissionId = `sub_${randomUUID()}`;
  const correct = results.filter((r) => r.isCorrect).length;

  await prisma.$transaction([
    prisma.attempt.createMany({
      data: results.map((r) => ({
        questionId: r.questionId,
        subtopicId,
        sessionKey: sessionKey ?? null,
        submissionId,
        chosenOptionIndex: r.chosenOptionIndex,
        isCorrect: r.isCorrect,
      })),
    }),
  ]);

  return {
    subtopicId,
    submissionId,
    score: { correct, total: results.length },
    results,
  };
}