import { chatJson } from "./client";
import { AiError } from "./client";
import { ZodError } from "zod";
import {
  analyzeInputSchema,
  generatePlanInputSchema,
  interviewInputSchema,
  interviewOutputSchema,
  planOutputSchema,
  type AnalyzeInput,
  type GeneratePlanInput,
  type InterviewInput,
} from "./schemas";

const MAX_AI_RETRIES = 2;
const retryableAiCodes = new Set(["SERVER", "RATE_LIMIT", "UNKNOWN", "EMPTY", "PARSE"]);

async function requestValidated<T>(
  request: (repairInstruction: string) => Promise<unknown>,
  validate: (raw: unknown) => T,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_AI_RETRIES; attempt += 1) {
    try {
      return validate(await request(
        attempt === 0
          ? ""
          : "\nRepair instruction: return only valid JSON matching the requested schema. Do not include markdown fences or explanatory text.",
      ));
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ZodError
        || (error instanceof AiError && retryableAiCodes.has(error.code));
      if (!retryable || attempt === MAX_AI_RETRIES) throw error;
    }
  }
  throw lastError;
}

export async function interview(input: InterviewInput) {
  const parsed = interviewInputSchema.parse(input);
  return requestValidated(
    (repairInstruction) => chatJson({
      system: `You are a concise adaptive onboarding interviewer for a realistic personal scheduler. Ask only the next question needed to schedule the goal. Never invent fixed commitment times or tasks. Return JSON only. Required output: either {complete:false,question,reason,field,required} or {complete:true,summary}.${repairInstruction}`,
      user: JSON.stringify(parsed),
    }),
    (raw) => interviewOutputSchema.parse(raw),
  );
}

export async function analyzeGoal(input: AnalyzeInput) {
  const parsed = analyzeInputSchema.parse(input);
  return generatePlan({
    goal: parsed.goal,
    deadline: parsed.deadline,
    availableMinutesPerWeek: parsed.availableMinutesPerWeek,
    currentKnowledge: parsed.currentKnowledge,
    profile: parsed.profile,
  });
}

export async function generatePlan(input: GeneratePlanInput) {
  const parsed = generatePlanInputSchema.parse(input);

  const systemPrompt = `You are a realistic, conservative AI Schedule Planning Assistant.
Your job is to take a user's goal and their routine availability, infer reasonable details (skill level, difficulty progression, session durations), and build an actionable personalized plan.
Do NOT interrogate the user or ask follow-up questions. Infer reasonable assumptions based on the goal description.
Ensure each task is realistic and actionable between 20 to 120 minutes.
Return JSON ONLY matching this format:
{
  "goal": "string (clear concise goal)",
  "target": "string (tangible outcome / target)",
  "durationDays": number (inferred or explicit total duration in days, e.g. 30),
  "assumptions": ["string (e.g. Inferred beginner DSA knowledge based on description)", "string (1-2 hours/day evenings)"],
  "strategy": "string (1-2 sentences explaining overall learning or execution approach)",
  "realistic": true,
  "milestones": [
    {
      "title": "string",
      "description": "string",
      "estimatedMinutes": number,
      "order": number,
      "tasks": [
        {
          "title": "string",
          "description": "string",
          "estimatedMinutes": number,
          "priority": "HIGH" | "MEDIUM" | "LOW",
          "dependencies": []
        }
      ]
    }
  ],
  "schedule": [
    {
      "day": number,
      "title": "string",
      "tasks": [
        { "title": "string", "estimatedMinutes": number, "priority": "HIGH" | "MEDIUM" | "LOW" }
      ],
      "estimatedMinutes": number
    }
  ]
}`;

  const userPrompt = JSON.stringify({
    goal: parsed.goal,
    deadline: parsed.deadline,
    hoursPerDay: parsed.hoursPerDay,
    daysAvailable: parsed.daysAvailable,
    preferredTime: parsed.preferredTime,
    difficulty: parsed.difficulty,
    modificationPrompt: parsed.modificationPrompt,
  });

  return requestValidated(
    (repairInstruction) => chatJson({
      system: `${systemPrompt}
Never turn fixed life commitments such as jobs, classes, commutes, appointments, or recurring responsibilities into goals, milestones, or tasks. Plan only the user&apos;s explicit accomplishment goal. Actual calendar times are assigned deterministically by the application around commitments.${repairInstruction}`,
      user: userPrompt,
      maxTokens: 3800,
      temperature: 0.2,
    }),
    (raw) => planOutputSchema.parse(raw),
  );
}
