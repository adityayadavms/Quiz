export type DifficultyLabel = "easy" | "medium" | "hard";

export function labelForScore(score: number): DifficultyLabel {
  if (score < 1 || score > 100) throw new Error(`difficultyScore out of range: ${score}`);
  if (score <= 40) return "easy";
  if (score <= 70) return "medium";
  return "hard";
}