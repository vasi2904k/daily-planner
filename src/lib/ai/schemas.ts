import { z } from "zod";

export const interviewInputSchema = z.object({
  goal: z.string().trim().min(3).max(500),
  deadline: z.string().optional(),
  knownProfile: z.record(z.string(), z.unknown()).default({}),
  previousAnswers: z.array(z.object({ field: z.string(), answer: z.string() })).default([]),
});

export const interviewOutputSchema = z.union([
  z.object({
    complete: z.literal(false),
    question: z.string().min(1),
    reason: z.string().min(1),
    field: z.string().min(1),
    required: z.boolean(),
  }),
  z.object({ complete: z.literal(true), summary: z.record(z.string(), z.unknown()) }),
]);

export const analyzeInputSchema = z.object({
  goal: z.string().trim().min(3).max(1000),
  deadline: z.string().optional().default(""),
  currentKnowledge: z.string().default(""),
  availableMinutesPerWeek: z.number().int().positive().optional().default(600),
  profile: z.record(z.string(), z.unknown()).default({}),
});

export const generatePlanInputSchema = z.object({
  goal: z.string().trim().min(3).max(1000),
  deadline: z.string().optional().default(""),
  hoursPerDay: z.string().optional().default("1–2 hours"),
  daysAvailable: z.array(z.string()).optional().default([
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  ]),
  preferredTime: z.string().optional().default("Evening"),
  difficulty: z.string().optional().default("moderate"),
  modificationPrompt: z.string().optional(),
  currentKnowledge: z.string().optional().default(""),
  availableMinutesPerWeek: z.number().int().positive().optional(),
  profile: z.record(z.string(), z.unknown()).default({}),
});

const taskItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  estimatedMinutes: z.number().int().min(15).max(240).default(60),
  priority: z.preprocess(
    (val) => (typeof val === "string" ? val.toUpperCase() : val),
    z.enum(["HIGH", "MEDIUM", "LOW"]).catch("MEDIUM"),
  ),
  dependencies: z.array(z.string()).default([]),
});

const milestoneItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  estimatedMinutes: z.number().int().positive().default(300),
  order: z.number().int().positive().default(1),
  tasks: z.array(taskItemSchema).default([]),
});

const scheduleDayTaskSchema = z.object({
  title: z.string().min(1),
  estimatedMinutes: z.number().int().default(60),
  priority: z.string().optional(),
});

const scheduleDaySchema = z.object({
  day: z.number().int().positive(),
  title: z.string().min(1),
  tasks: z.array(scheduleDayTaskSchema).default([]),
  estimatedMinutes: z.number().int().default(60),
});

export const planOutputSchema = z.object({
  goal: z.string().optional(),
  target: z.string().optional(),
  durationDays: z.number().int().positive().optional(),
  assumptions: z.array(z.string()).default([]),
  strategy: z.string().optional(),
  realistic: z.boolean().default(true),
  warning: z.string().optional(),
  milestones: z.array(milestoneItemSchema).default([]),
  schedule: z.array(scheduleDaySchema).default([]),
});

export type InterviewInput = z.infer<typeof interviewInputSchema>;
export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;
export type GeneratePlanInput = z.input<typeof generatePlanInputSchema>;
export type PlanOutput = z.infer<typeof planOutputSchema>;
