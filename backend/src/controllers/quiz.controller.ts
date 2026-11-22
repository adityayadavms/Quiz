import type { Request, Response } from "express";
import { err } from "../lib/http.js";
import {
  CUID_RE,
  QuizError,
  getPoolForSubtopic,

  gradeSubmission,
  type SubmittedAnswer,
} from "../services/quiz.service.js";

// Map a domain QuizError to the HTTP response. Re-throw anything else.
function handleQuizError(res: Response, e: unknown) {
  if (e instanceof QuizError) {
    return err(res, e.status, e.code, e.message);
  }
  throw e;
}

// ─────────────────────────────────────────────────────────────
// GET /api/pool?subtopicId=<cuid>
// ─────────────────────────────────────────────────────────────
export async function getPool(req: Request, res: Response) {
  const subtopicId = String(req.query.subtopicId ?? "");

  if (!CUID_RE.test(subtopicId)) {
    return err(res, 400, "BAD_SUBTOPIC_ID", "subtopicId must be a cuid");
  }

  try {
    const pool = await getPoolForSubtopic(subtopicId);
    return res.json(pool);
  } catch (e) {
    return handleQuizError(res, e);
  }
}




// ─────────────────────────────────────────────────────────────
// POST /api/submit
// body: { subtopicId, sessionKey?, answers: [{ questionId, chosenOptionIndex }] }
// ─────────────────────────────────────────────────────────────
export async function submitQuiz(req: Request, res: Response) {
  const { subtopicId, sessionKey, answers } = req.body ?? {};

  if (typeof subtopicId !== "string" || !CUID_RE.test(subtopicId)) {
    return err(res, 400, "BAD_SUBTOPIC_ID", "subtopicId must be a cuid");
  }
  if (sessionKey !== undefined && sessionKey !== null && typeof sessionKey !== "string") {
    return err(res, 400, "BAD_SESSION_KEY", "sessionKey must be a string if provided");
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    return err(res, 400, "EMPTY_ANSWERS", "answers must be a non-empty array");
  }

  for (const a of answers) {
    if (
      !a ||
      typeof a.questionId !== "string" ||
      !CUID_RE.test(a.questionId) ||
      typeof a.chosenOptionIndex !== "number" ||
      !Number.isInteger(a.chosenOptionIndex)
    ) {
      return err(
        res,
        400,
        "BAD_ANSWER_ITEM",
        "each answer needs a cuid questionId and integer chosenOptionIndex"
      );
    }
  }

  try {
    const result = await gradeSubmission({
      subtopicId,
      sessionKey,
      answers: answers as SubmittedAnswer[],
    });
    return res.json(result);
  } catch (e) {
    return handleQuizError(res, e);
  }
}