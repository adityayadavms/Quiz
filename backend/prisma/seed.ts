import { labelForScore } from "../src/lib/difficulty.js";
import {prisma} from "../src/db.js"

type SeedQ = {
  familyId: string;
  conceptTag: string;
  score: number;
  role: "primary" | "backup";
  text: string;
  options: string[];
  correct: number;
  explanation: string;
};

const DUMMY: SeedQ[] = [
  // 6 primary, each with a matching familyId on a backup below
  { familyId: "fam_value",   conceptTag: "biodiversity_value",    score: 22, role: "primary",
    text: "Which statement best summarizes the chapter?",
    options: ["Only aesthetic value.", "Essential for ecological stability and human survival.", "Only endangered animals matter.", "Cannot coexist with development."],
    correct: 1, explanation: "The textbook emphasizes ecological stability and human survival as the core value." },
  { familyId: "fam_threats", conceptTag: "biodiversity_threats",  score: 30, role: "primary",
    text: "The 'evil quartet' of biodiversity loss refers to which four threats?",
    options: ["Habitat loss, overexploitation, invasive species, co-extinctions.", "Pollution, climate change, overpopulation, war.", "Deforestation, mining, damming, grazing.", "Hunting, fishing, logging, farming."],
    correct: 0, explanation: "Habitat loss, overexploitation, alien species, and co-extinctions form the evil quartet." },
  { familyId: "fam_patterns", conceptTag: "biodiversity_patterns", score: 45, role: "primary",
    text: "Species-area relationship is described by which equation?",
    options: ["S = cA^z", "S = cA", "S = c + A", "S = c/A"],
    correct: 0, explanation: "S = cA^z, where z is the slope (0.1–0.2 within a region)." },
  { familyId: "fam_hotspots", conceptTag: "biodiversity_hotspots", score: 58, role: "primary",
    text: "Which is NOT a biodiversity hotspot criterion?",
    options: ["High endemism", "High threat of habitat loss", "Maximum species richness", "Island isolation"],
    correct: 3, explanation: "Hotspots need high endemism and high threat; island isolation is not a criterion." },
  { familyId: "fam_conservation", conceptTag: "conservation_strategies", score: 72, role: "primary",
    text: "In-situ conservation means:",
    options: ["Conserving species in their natural habitat.", "Conserving species in zoos.", "Conserving seeds in a bank.", "Conserving species in botanical gardens."],
    correct: 0, explanation: "In-situ = in the natural habitat. Ex-situ = outside it." },
  { familyId: "fam_treaties", conceptTag: "conservation_treaties", score: 85, role: "primary",
    text: "The Ramsar Convention focuses on:",
    options: ["Wetlands and migratory birds.", "Trade in endangered species.", "Biodiversity at the genetic level.", "Climate change mitigation."],
    correct: 0, explanation: "Ramsar (1971) protects wetlands, especially as waterfowl habitat." },

  // 3 backups: one each on families where the loop is most likely to trigger
  { familyId: "fam_value",   conceptTag: "biodiversity_value",    score: 18, role: "backup",
    text: "Biodiversity provides which 'direct' economic benefit?",
    options: ["Ecosystem services.", "Food and medicine.", "Climate regulation.", "Nutrient cycling."],
    correct: 1, explanation: "Direct benefits include food, medicine, and industrial products." },
  { familyId: "fam_patterns", conceptTag: "biodiversity_patterns", score: 55, role: "backup",
    text: "In the species-area curve, a steeper slope z suggests:",
    options: ["Lower endemism.", "Faster species turnover with area.", "No relationship.", "Uniform distribution."],
    correct: 1, explanation: "Higher z means species richness grows faster with area, typical of islands." },
  { familyId: "fam_conservation", conceptTag: "conservation_strategies", score: 68, role: "backup",
    text: "Which is an ex-situ conservation method?",
    options: ["Biosphere reserve.", "National park.", "Cryopreservation of gametes.", "Sacred grove."],
    correct: 2, explanation: "Cryopreservation is ex-situ: it preserves genetic material outside the natural habitat." },
];

async function main() {
  // Clean slate (dev only — never in prod)
  await prisma.attempt.deleteMany();
  await prisma.question.deleteMany();
  await prisma.concept.deleteMany();
  await prisma.subtopic.deleteMany();
  await prisma.topic.deleteMany();
  await prisma.chapter.deleteMany();

  const chapter = await prisma.chapter.create({
    data: { subject: "biology", name: "Biodiversity and Conservation", order: 1 },
  });
  const topic = await prisma.topic.create({
    data: { chapterId: chapter.id, name: "Chapter Summary", order: 1 },
  });
  const subtopic = await prisma.subtopic.create({
    data: {
      id: "clx9k2p0b0000abcd1234efgh", // fixed ID so tests are stable
      topicId: topic.id,
      name: "Core Message",
      order: 1,
    },
  });

  // concepts from the tags used
  const tags = [...new Set(DUMMY.map(q => q.conceptTag))];
  await prisma.concept.createMany({
    data: tags.map(tag => ({ subtopicId: subtopic.id, tag, name: tag.replace(/_/g, " ") })),
  });

  for (const q of DUMMY) {
    const label = labelForScore(q.score);
    await prisma.question.create({
      data: {
        subtopicId: subtopic.id,
        conceptTag: q.conceptTag,
        familyId: q.familyId,
        difficultyScore: q.score,
        difficultyLabel: label,
        role: q.role,
        board: "CBSE",
        grade: 12,
        content: {
          questionText: q.text,
          questionLatex: "",
          options: q.options,
        },
        answer: {
          correctOptionIndex: q.correct,
          explanation: q.explanation,
        },
      },
    });
  }

  const [p, b] = await Promise.all([
    prisma.question.count({ where: { subtopicId: subtopic.id, role: "primary" } }),
    prisma.question.count({ where: { subtopicId: subtopic.id, role: "backup" } }),
  ]);
  console.log(`Seeded ${p} primary + ${b} backup questions.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());