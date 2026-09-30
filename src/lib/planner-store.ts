import { z } from "zod";
import { addDays, demoTasks, localDate, type PlannerTask, type TaskStatus } from "./scheduler";

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  duration: z.number().int().positive(),
  date: z.string().date(),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "SKIPPED"]),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
  milestone: z.string(),
  goalId: z.string().optional(),
  skipReason: z.string().optional(),
  scheduleStatus: z.literal("UNSCHEDULED").optional(),
});

export const goalSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(200),
  emoji: z.string().optional().default("🎯"),
  color: z.string().optional().default("#356b52"),
  status: z.enum(["ACTIVE", "PAUSED"]).optional().default("ACTIVE"),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().default("MEDIUM"),
  createdAt: z.string().optional(),
  deadline: z.string().optional(),
});

export type GoalItem = z.infer<typeof goalSchema>;

const commitmentDaySchema = z.enum([
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]);

export const commitmentSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(200),
  type: z.enum(["work", "college", "gym", "commute", "appointment", "responsibility", "other"]),
  daysOfWeek: z.array(commitmentDaySchema).min(1),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  notes: z.string().max(1000).default(""),
  color: z.string().default("#2563eb"),
  icon: z.string().default("📌"),
  status: z.enum(["ACTIVE", "PAUSED"]).default("ACTIVE"),
}).refine((commitment) => commitment.startTime < commitment.endTime, {
  message: "Commitment must end after it starts.",
  path: ["endTime"],
});

export type CommitmentItem = z.infer<typeof commitmentSchema>;

const plannerSchema = z.object({
  version: z.literal(2),
  tasks: z.array(taskSchema),
  goals: z.array(goalSchema),
  commitments: z.array(commitmentSchema),
  activeGoalId: z.string().optional().default(""),
}).refine(
  (state) =>
    state.goals.length === 0 ||
    !state.activeGoalId ||
    state.goals.some((goal) => goal.id === state.activeGoalId),
  { message: "Active goal must exist in goals array when goals are present" },
);

export type PlannerState = {
  version: 2;
  tasks: PlannerTask[];
  goals: GoalItem[];
  commitments: CommitmentItem[];
  activeGoalId: string;
};

const legacyPlannerSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema),
  goals: z.array(goalSchema),
  activeGoalId: z.string().optional().default(""),
});

export const storageKey = "daily-scheduler-v1";

export function pickGoalEmoji(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("python") || lower.includes("django") || lower.includes("flask")) return "🐍";
  if (lower.includes("dsa") || lower.includes("leetcode") || lower.includes("algorithm")) return "🧩";
  if (lower.includes("fastapi") || lower.includes("api") || lower.includes("backend")) return "⚡";
  if (lower.includes("ai") || lower.includes("ml") || lower.includes("data") || lower.includes("llm")) return "🤖";
  if (lower.includes("react") || lower.includes("web") || lower.includes("front") || lower.includes("next")) return "⚛️";
  if (lower.includes("rust")) return "🦀";
  if (lower.includes("go") || lower.includes("golang")) return "🐹";
  if (lower.includes("java")) return "☕";
  if (lower.includes("read") || lower.includes("book") || lower.includes("study") || lower.includes("learn")) return "📚";
  if (lower.includes("run") || lower.includes("workout") || lower.includes("fit") || lower.includes("gym")) return "🏃";
  if (lower.includes("write") || lower.includes("blog")) return "✍️";
  return "🎯";
}

export function pickGoalColor(index: number): string {
  const palette = ["#356b52", "#c86d3e", "#2563eb", "#7c3aed", "#db2777", "#d97706", "#059669"];
  return palette[index % palette.length];
}

export function initialPlanner(today: string): PlannerState {
  const offsets = [0, 0, 0, 1, 2, 3, 4];
  return {
    version: 2,
    tasks: demoTasks.map((task, index) => ({
      ...task,
      goalId: "example",
      date: addDays(today, offsets[index]),
    })),
    goals: [
      {
        id: "example",
        title: "Become a Python Developer (example)",
        emoji: "🐍",
        color: "#356b52",
        status: "ACTIVE",
        priority: "HIGH",
        createdAt: today,
      },
    ],
    commitments: [],
    activeGoalId: "example",
  };
}

export function parsePlanner(raw: string): PlannerState {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && "version" in parsed && parsed.version === 1) {
    const legacy = legacyPlannerSchema.parse(parsed);
    return { ...legacy, version: 2, commitments: [] };
  }
  return plannerSchema.parse(parsed);
}

export function addGoal(
  state: PlannerState,
  title: string,
  id: string,
  extra: Partial<GoalItem> = {},
): PlannerState {
  const name = z.string().trim().min(1).max(200).parse(title);
  const emoji = extra.emoji || pickGoalEmoji(name);
  const color = extra.color || pickGoalColor(state.goals.length);
  const status = extra.status || "ACTIVE";
  const priority = extra.priority || "MEDIUM";

  const newGoal: GoalItem = {
    id,
    title: name,
    emoji,
    color,
    status,
    priority,
    createdAt: localDate(),
    deadline: extra.deadline,
  };

  return {
    ...state,
    goals: [...state.goals, newGoal],
    activeGoalId: id,
  };
}

export function addCommitment(state: PlannerState, commitment: CommitmentItem): PlannerState {
  const parsed = commitmentSchema.parse(commitment);
  return { ...state, commitments: [...state.commitments, parsed] };
}

export function deleteCommitment(state: PlannerState, commitmentId: string): PlannerState {
  return {
    ...state,
    commitments: state.commitments.filter((commitment) => commitment.id !== commitmentId),
  };
}

export function pauseCommitment(state: PlannerState, commitmentId: string): PlannerState {
  return {
    ...state,
    commitments: state.commitments.map((commitment) => commitment.id === commitmentId
      ? { ...commitment, status: "PAUSED" as const }
      : commitment),
  };
}

export function resumeCommitment(state: PlannerState, commitmentId: string): PlannerState {
  return {
    ...state,
    commitments: state.commitments.map((commitment) => commitment.id === commitmentId
      ? { ...commitment, status: "ACTIVE" as const }
      : commitment),
  };
}

export function addGoalWithTasks(
  state: PlannerState,
  title: string,
  id: string,
  newTasks: PlannerTask[] = [],
  extra: Partial<GoalItem> = {},
): PlannerState {
  const name = z.string().trim().min(1).max(200).parse(title);
  const emoji = extra.emoji || pickGoalEmoji(name);
  const color = extra.color || pickGoalColor(state.goals.length);
  const status = extra.status || "ACTIVE";
  const priority = extra.priority || "MEDIUM";

  const newGoal: GoalItem = {
    id,
    title: name,
    emoji,
    color,
    status,
    priority,
    createdAt: localDate(),
    deadline: extra.deadline,
  };
  const invalidTasks = newTasks.filter((task) => task.goalId !== id);
  if (invalidTasks.length > 0 && process.env.NODE_ENV === "development") {
    console.warn(`Skipped ${invalidTasks.length} task(s) that did not belong to goal ${id}.`);
  }
  const ownedTasks = newTasks.filter((task) => task.goalId === id);

  return {
    ...state,
    goals: [...state.goals, newGoal],
    tasks: [...state.tasks, ...ownedTasks],
    activeGoalId: id,
  };
}

export function deleteGoal(state: PlannerState, goalId: string): PlannerState {
  const remainingGoals = state.goals.filter((g) => g.id !== goalId);
  const remainingTasks = state.tasks.filter((t) => t.goalId !== goalId);
  let nextActiveId = state.activeGoalId;
  if (nextActiveId === goalId) {
    nextActiveId = remainingGoals[0]?.id || "";
  }
  return {
    ...state,
    goals: remainingGoals,
    tasks: remainingTasks,
    activeGoalId: nextActiveId,
  };
}

export function pauseGoal(state: PlannerState, goalId: string): PlannerState {
  return {
    ...state,
    goals: state.goals.map((g) => (g.id === goalId ? { ...g, status: "PAUSED" } : g)),
  };
}

export function resumeGoal(state: PlannerState, goalId: string): PlannerState {
  return {
    ...state,
    goals: state.goals.map((g) => (g.id === goalId ? { ...g, status: "ACTIVE" } : g)),
  };
}

export function setTaskStatus(state: PlannerState, taskId: string, status: TaskStatus): PlannerState {
  return {
    ...state,
    tasks: state.tasks.map((task) => task.id === taskId ? { ...task, status } : task),
  };
}

export function updateGoal(
  state: PlannerState,
  goalId: string,
  updates: {
    title?: string;
    priority?: "HIGH" | "MEDIUM" | "LOW";
    emoji?: string;
    color?: string;
  },
): PlannerState {
  return {
    ...state,
    goals: state.goals.map((g) => {
      if (g.id !== goalId) return g;
      const nextTitle = updates.title
        ? z.string().trim().min(1).max(200).parse(updates.title)
        : g.title;
      return {
        ...g,
        title: nextTitle,
        priority: updates.priority ?? g.priority,
        emoji: updates.emoji ?? g.emoji,
        color: updates.color ?? g.color,
      };
    }),
  };
}
