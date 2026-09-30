const existingRoutinePattern = /\b(balance|balancing|manage|managing|fit|fitting|schedule|scheduling)\b/i;
const commitmentPattern = /\b(full[- ]time job|part[- ]time job|work schedule|job|college|university|classes|studies|commute|responsibilit(?:y|ies))\b/i;

export function looksLikeCommitmentIntent(input: string): boolean {
  return existingRoutinePattern.test(input) && commitmentPattern.test(input);
}
