import express from "express";
import cors from "cors";
import quizRoutes from "./routes/quiz.routes.js";

const app = express();

app.use(cors());                               // Flutter web / device origin
app.use(express.json({ limit: "50kb" }));      // only 2-3 fields per body
app.use("/api", quizRoutes);

app.listen(4000, () => console.log("API on http://localhost:4000"));