import { Router } from "express";
import { getPool,  submitQuiz } from "../controllers/quiz.controller.js";

const router = Router();
router.get("/pool", getPool);

router.post("/submit", submitQuiz);
export default router;