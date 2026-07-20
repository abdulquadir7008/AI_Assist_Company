import { Department } from "@company-rag/database";

/**
 * Curated starter questions per department — the cold-start fallback when a
 * department has no (shareable) query history yet. Deliberately generic:
 * they reference nothing that could reveal restricted document contents.
 */
const starterQuestions: Record<Department, string[]> = {
  [Department.GENERAL]: [
    "What is our vacation and PTO policy?",
    "How do I submit an expense report?",
    "What are the company holidays this year?",
    "Where can I find the employee handbook?"
  ],
  [Department.ENGINEERING]: [
    "What is our code review process?",
    "How do I request access to production systems?",
    "What is the on-call rotation policy?",
    "What are our incident response procedures?"
  ],
  [Department.HR]: [
    "What is the onboarding checklist for new hires?",
    "What is our parental leave policy?",
    "How does the performance review cycle work?",
    "What benefits do employees receive?"
  ],
  [Department.LEGAL]: [
    "What is our standard contract review turnaround?",
    "What is the data retention policy?",
    "How do we handle NDA requests?",
    "What compliance training is required?"
  ],
  [Department.SALES]: [
    "What is our refund policy?",
    "What discounts am I allowed to offer?",
    "Where are the latest product pricing sheets?",
    "What is the sales commission structure?"
  ],
  [Department.SUPPORT]: [
    "What is the escalation process for urgent tickets?",
    "What are our SLA response times?",
    "How do I process a customer refund?",
    "Where are the product troubleshooting guides?"
  ],
  [Department.LEADERSHIP]: [
    "What are the quarterly OKR guidelines?",
    "What is the budget approval process?",
    "What is our hiring headcount policy?",
    "Where are the board meeting procedures documented?"
  ]
};

/** Starter questions for a department, excluding near-duplicates of `exclude`. */
export function pickStarters(
  department: Department,
  count: number,
  exclude: string[] = []
): string[] {
  const normalizedExclude = new Set(exclude.map((question) => normalizeQuestion(question)));
  return starterQuestions[department]
    .filter((question) => !normalizedExclude.has(normalizeQuestion(question)))
    .slice(0, Math.max(0, count));
}

/** Case/spacing/punctuation-insensitive key for grouping identical questions. */
export function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/\s+/g, " ").replace(/[?.!]+$/g, "").trim();
}
