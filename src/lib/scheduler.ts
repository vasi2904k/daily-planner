export type TaskStatus = "TODO" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";

export type PlannerTask = {
  id: string;
  title: string;
  category: string;
  duration: number;
  date: string;
  start: string;
  end: string;
  status: TaskStatus;
  priority: "HIGH" | "MEDIUM" | "LOW";
  milestone: string;
  goalId?: string;
  skipReason?: string;
  scheduleStatus?: "UNSCHEDULED";
};

export type TimeWindow = {
  start: number;
  end: number;
};

export type CommitmentWindow = {
  daysOfWeek: string[];
  startTime: string;
  endTime: string;
  startDate?: string;
  endDate?: string;
  status?: "ACTIVE" | "PAUSED";
};

export type PlannedGoalTask = {
  title: string;
  category: string;
  duration: number;
  priority: "HIGH" | "MEDIUM" | "LOW";
  milestone: string;
};

export type UnscheduledGoalTask = PlannedGoalTask & { goalId: string };
export type ScheduleCandidateDiagnostic = {
  taskTitle: string;
  date: string;
  availableTimeWindow: string;
  commitmentBlocks: string[];
  existingGoalTaskBlocks: string[];
  requestedDuration: number;
  candidateSlot: string | null;
  result: "ACCEPTED" | "REJECTED";
  rejectionReason?: string;
};
export type GoalTaskScheduleResult = {
  scheduledTasks: PlannerTask[];
  unscheduledTasks: UnscheduledGoalTask[];
  candidateDiagnostics: ScheduleCandidateDiagnostic[];
  searchWindow: { startDate: string; lastDate: string; maxDaysToSchedule: number };
};

export function explicitSessionDuration(goalDescription: string): number | undefined {
  const match = goalDescription.match(/\b(\d{1,3})\s*(?:minutes?|mins?)\s*(?:(?:per|each|in each)\s+sessions?|\/\s*session)\b/i)
    ?? goalDescription.match(/\b(\d{1,3})[- ]minute\s+sessions?\b/i);
  if (!match) return undefined;
  const duration = Number(match[1]);
  return Number.isInteger(duration) && duration > 0 && duration <= 240 ? duration : undefined;
}

export function explicitDeadlineDays(deadlineDescription: string, startDate: string): number | undefined {
  const deadlineDate = deadlineDescription.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (deadlineDate) {
    const match = deadlineDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return undefined;
    const [year, month, day] = match.slice(1).map(Number);
    const deadlineUtc = Date.UTC(year, month - 1, day);
    const validDate = new Date(deadlineUtc);
    if (validDate.getUTCFullYear() !== year || validDate.getUTCMonth() !== month - 1 || validDate.getUTCDate() !== day) return undefined;
    const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
    return Math.max(0, Math.floor((deadlineUtc - Date.UTC(startYear, startMonth - 1, startDay)) / 86_400_000) + 1);
  }
  const duration = deadlineDescription.match(/\b(\d+)\s*(days?|weeks?|months?)\b/i);
  if (!duration) return undefined;
  const amount = Number(duration[1]);
  const unit = duration[2].toLowerCase();
  return amount * (unit.startsWith("week") ? 7 : unit.startsWith("month") ? 30 : 1);
}

export function activeGoalTasks(tasks: PlannerTask[], goals: Array<{ id: string; status?: "ACTIVE" | "PAUSED" }>) {
  const knownGoalIds = new Set(goals.map((goal) => goal.id));
  return tasks.filter((task) => Boolean(task.goalId) && knownGoalIds.has(task.goalId as string) && task.status !== "SKIPPED" && task.scheduleStatus !== "UNSCHEDULED");
}

export function scheduledGoalTasks(tasks: PlannerTask[], goals: Array<{ id: string }>) {
  const knownGoalIds = new Set(goals.map((goal) => goal.id));
  return tasks.filter((task) => Boolean(task.goalId) && knownGoalIds.has(task.goalId as string) && task.status !== "SKIPPED" && task.scheduleStatus !== "UNSCHEDULED");
}

export type ScheduleContentMode = "goals" | "commitments" | "combined";
export type ScheduleEvent =
  | { kind: "goal"; time: string; task: PlannerTask }
  | { kind: "commitment"; time: string; commitment: CommitmentWindow & { id: string; title: string; color?: string; icon?: string; notes?: string } };

export function scheduleEventsForDay(
  tasks: PlannerTask[],
  goals: Array<{ id: string }>,
  commitments: Array<CommitmentWindow & { id: string; title: string; color?: string; icon?: string; notes?: string }>,
  date: string,
  mode: ScheduleContentMode,
): ScheduleEvent[] {
  const events: ScheduleEvent[] = [
    ...(mode === "commitments" ? [] : scheduledGoalTasks(tasks, goals)
      .filter((task) => task.date === date)
      .map((task) => ({ kind: "goal" as const, time: task.start, task }))),
    ...(mode === "goals" ? [] : commitments
      .filter((commitment) => commitment.status !== "PAUSED"
        && commitment.daysOfWeek.includes(new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(`${date}T12:00:00`)) as string)
        && (!commitment.startDate || date >= commitment.startDate)
        && (!commitment.endDate || date <= commitment.endDate))
      .map((commitment) => ({ kind: "commitment" as const, time: commitment.startTime, commitment }))),
  ];
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

function inspectAvailableSlot(
  date: string,
  durationMinutes: number,
  preferredTime: string,
  occupiedTasksOnDate: PlannerTask[],
  commitments: CommitmentWindow[],
): { slot: { start: string; end: string } | null; rejectionReason?: string; availableTimeWindow: string } {
  const isWeekend = [0, 6].includes(new Date(`${date}T12:00:00`).getDay());
  const windows = [
    ...(isWeekend ? fixedWindows.slice(1) : fixedWindows),
    ...commitmentWindowsForDate(date, commitments),
  ];
  let prefStart = 19 * 60 + 45;
  let prefEnd = 23 * 60 + 15;
  if (preferredTime === "Morning") {
    prefStart = 7 * 60 + 30;
    prefEnd = 10 * 60 + 30;
  } else if (preferredTime === "Afternoon") {
    prefStart = 13 * 60;
    prefEnd = 17 * 60;
  } else if (preferredTime === "Night") {
    prefStart = 21 * 60 + 15;
    prefEnd = 23 * 60 + 15;
  }

  const windowLabel = `preferred ${clockTime(prefStart)}–${clockTime(prefEnd)}; fallback 07:30–23:30`;
  const blockers = new Set<string>();
  const isFree = (start: number) => {
    const end = start + durationMinutes;
    let free = true;
    if (overlapsFixedWindow(start / 60, end / 60, windows.slice(0, isWeekend ? 1 : 2))) {
      blockers.add("quiet hours");
      free = false;
    }
    if (commitmentWindowsForDate(date, commitments).some((window) => start < window.end * 60 && end > window.start * 60)) {
      blockers.add("commitment conflict");
      free = false;
    }
    if (occupiedTasksOnDate.some((task) => start < timeMinutes(task.end) && end > timeMinutes(task.start))) {
      blockers.add("existing goal-task conflict");
      free = false;
    }
    return free;
  };

  for (let start = prefStart; start + durationMinutes <= prefEnd; start += 15) {
    if (isFree(start)) return { slot: { start: clockTime(start), end: clockTime(start + durationMinutes) }, availableTimeWindow: windowLabel };
  }
  for (let start = 450; start + durationMinutes <= 1410; start += 15) {
    if (isFree(start)) return { slot: { start: clockTime(start), end: clockTime(start + durationMinutes) }, availableTimeWindow: windowLabel };
  }
  const fitsPreferredWindow = durationMinutes <= prefEnd - prefStart;
  const fitsFallbackWindow = durationMinutes <= 1410 - 450;
  const rejectionReason = !fitsPreferredWindow && !fitsFallbackWindow
    ? "insufficient duration for available windows"
    : blockers.size > 0
      ? [...blockers].join(", ")
      : "no valid slot in the available time windows";
  return { slot: null, rejectionReason, availableTimeWindow: windowLabel };
}

export function scheduleGoalTasks(
  plannedTasks: PlannedGoalTask[],
  goalId: string,
  startDate: string,
  preferredTime: string,
  daysAvailable: string[],
  existingTasks: PlannerTask[] = [],
  commitments: CommitmentWindow[] = [],
  dailyMinutesLimit?: number,
  maxDaysToSchedule = 365,
): PlannerTask[] {
  const result = scheduleGoalTasksPartial(plannedTasks, goalId, startDate, preferredTime, daysAvailable, existingTasks, commitments, dailyMinutesLimit, maxDaysToSchedule);
  if (result.unscheduledTasks.length > 0) {
    throw new Error(`Not enough available time to schedule "${result.unscheduledTasks[0].title}" without shortening it.`);
  }
  return result.scheduledTasks;
}

export function scheduleGoalTasksPartial(
  plannedTasks: PlannedGoalTask[],
  goalId: string,
  startDate: string,
  preferredTime: string,
  daysAvailable: string[],
  existingTasks: PlannerTask[] = [],
  commitments: CommitmentWindow[] = [],
  dailyMinutesLimit?: number,
  maxDaysToSchedule = 365,
): GoalTaskScheduleResult {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const allowedDays = new Set(daysAvailable.map((day) => dayNames.indexOf(day)).filter((day) => day >= 0));
  if (allowedDays.size === 0) dayNames.forEach((_, index) => allowedDays.add(index));
  if (dailyMinutesLimit !== undefined && (!Number.isInteger(dailyMinutesLimit) || dailyMinutesLimit <= 0)) {
    throw new Error("Daily available time must be a positive number of minutes.");
  }
  const result: PlannerTask[] = [];
  const existingIds = new Set(existingTasks.map((task) => task.id));
  let nextId = 1;
  const unscheduledTasks: UnscheduledGoalTask[] = [];
  const candidateDiagnostics: ScheduleCandidateDiagnostic[] = [];
  let dayOffset = 0;

  for (const item of plannedTasks) {
    if (!Number.isInteger(item.duration) || item.duration <= 0) {
      throw new Error(`Session "${item.title}" has an invalid duration.`);
    }
    let scheduled: PlannerTask | undefined;
    let scheduledDayOffset: number | undefined;
    for (let candidateOffset = dayOffset; candidateOffset < maxDaysToSchedule; candidateOffset += 1) {
      const date = addDays(startDate, candidateOffset);
      const weekday = new Date(`${date}T12:00:00`).getDay();
      const commitmentBlocks = commitmentWindowsForDate(date, commitments).map((window) => `${clockTime(window.start * 60)}–${clockTime(window.end * 60)}`);
      if (!allowedDays.has(weekday)) {
        candidateDiagnostics.push({ taskTitle: item.title, date, availableTimeWindow: "none (selected day unavailable)", commitmentBlocks, existingGoalTaskBlocks: [], requestedDuration: item.duration, candidateSlot: null, result: "REJECTED", rejectionReason: "unavailable selected day" });
        continue;
      }
      const occupied = [
        ...existingTasks.filter((task) => task.date === date && task.status !== "SKIPPED" && task.scheduleStatus !== "UNSCHEDULED" && timeMinutes(task.end) > timeMinutes(task.start)),
        ...result.filter((task) => task.date === date && task.status !== "SKIPPED"),
      ];
      const existingGoalTaskBlocks = occupied.map((task) => `${task.start}–${task.end} (${task.title})`);
      const plannedMinutes = occupied.reduce((total, task) => total + task.duration, 0);
      if (dailyMinutesLimit !== undefined && plannedMinutes + item.duration > dailyMinutesLimit) {
        candidateDiagnostics.push({ taskTitle: item.title, date, availableTimeWindow: `daily limit ${dailyMinutesLimit}m; already scheduled ${plannedMinutes}m`, commitmentBlocks, existingGoalTaskBlocks, requestedDuration: item.duration, candidateSlot: null, result: "REJECTED", rejectionReason: "insufficient remaining daily workload allowance" });
        continue;
      }
      const inspection = inspectAvailableSlot(date, item.duration, preferredTime, occupied, commitments);
      const slot = inspection.slot;
      candidateDiagnostics.push({ taskTitle: item.title, date, availableTimeWindow: inspection.availableTimeWindow, commitmentBlocks, existingGoalTaskBlocks, requestedDuration: item.duration, candidateSlot: slot ? `${slot.start}–${slot.end}` : null, result: slot ? "ACCEPTED" : "REJECTED", rejectionReason: inspection.rejectionReason });
      if (!slot) continue;
      let id = `task-${goalId}-${nextId++}`;
      while (existingIds.has(id)) id = `task-${goalId}-${nextId++}`;
      existingIds.add(id);
      scheduled = {
        id,
        title: item.title,
        category: item.category,
        duration: item.duration,
        date,
        start: slot.start,
        end: slot.end,
        status: "TODO",
        priority: item.priority,
        milestone: item.milestone,
        goalId,
      };
      result.push(scheduled);
      scheduledDayOffset = candidateOffset;
      break;
    }
    if (!scheduled) {
      unscheduledTasks.push({ ...item, goalId });
    } else if (scheduledDayOffset !== undefined) {
      dayOffset = scheduledDayOffset + 1;
    }
  }
  return {
    scheduledTasks: result,
    unscheduledTasks,
    candidateDiagnostics,
    searchWindow: { startDate, lastDate: addDays(startDate, maxDaysToSchedule - 1), maxDaysToSchedule },
  };
}

export const demoTasks: PlannerTask[] = [
  { id: "task-1", title: "Python functions", category: "Python foundations", duration: 60, date: "2026-09-30", start: "08:00", end: "09:00", status: "COMPLETED", priority: "HIGH", milestone: "Core Python" },
  { id: "task-2", title: "Build a CLI habit tracker", category: "Projects", duration: 75, date: "2026-09-30", start: "19:45", end: "21:00", status: "TODO", priority: "HIGH", milestone: "Core Python" },
  { id: "task-3", title: "Review error handling", category: "Python foundations", duration: 30, date: "2026-09-30", start: "21:15", end: "21:45", status: "TODO", priority: "MEDIUM", milestone: "Core Python" },
  { id: "task-4", title: "SQL joins practice", category: "Data foundations", duration: 45, date: "2026-10-01", start: "08:00", end: "08:45", status: "TODO", priority: "MEDIUM", milestone: "Data foundations" },
  { id: "task-5", title: "FastAPI route design", category: "Backend", duration: 60, date: "2026-10-02", start: "19:45", end: "20:45", status: "TODO", priority: "HIGH", milestone: "Ship one project" },
  { id: "task-6", title: "Ship the first endpoint", category: "Backend", duration: 90, date: "2026-10-03", start: "10:00", end: "11:30", status: "TODO", priority: "HIGH", milestone: "Ship one project" },
  { id: "task-7", title: "Refactor and write README", category: "Projects", duration: 60, date: "2026-10-04", start: "10:30", end: "11:30", status: "TODO", priority: "MEDIUM", milestone: "Ship one project" },
];

export const fixedWindows: TimeWindow[] = [
  { start: 23.5, end: 24 },
  { start: 0, end: 7.5 },
];

export function commitmentWindowsForDate(date: string, commitments: CommitmentWindow[]): TimeWindow[] {
  const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(`${date}T12:00:00`));
  return commitments
    .filter((commitment) => {
      if (commitment.status === "PAUSED" || !commitment.daysOfWeek.includes(dayName)) return false;
      if (commitment.startDate && date < commitment.startDate) return false;
      if (commitment.endDate && date > commitment.endDate) return false;
      return true;
    })
    .map((commitment) => ({
      start: timeMinutes(commitment.startTime) / 60,
      end: timeMinutes(commitment.endTime) / 60,
    }));
}

export function overlapsFixedWindow(start: number, end: number, windows = fixedWindows) {
  return windows.some((window) => start < window.end && end > window.start);
}

export function canScheduleTask(start: number, durationMinutes: number, dailyGoalMinutes: number, plannedTodayMinutes: number) {
  if (![start, durationMinutes, dailyGoalMinutes, plannedTodayMinutes].every(Number.isFinite) || start < 0 || start >= 24 || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || dailyGoalMinutes <= 0 || plannedTodayMinutes < 0) return false;
  const end = start + durationMinutes / 60;
  return !overlapsFixedWindow(start, end) && plannedTodayMinutes + durationMinutes <= dailyGoalMinutes && end <= 23.5;
}

export function completionPercent(tasks: PlannerTask[]) {
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((task) => task.status === "COMPLETED").length / tasks.length) * 100);
}

export function redistributeTask(task: PlannerTask, nextAvailableDates: string[], existing: PlannerTask[] = [], commitments: CommitmentWindow[] = []) {
  if (!Number.isInteger(task.duration) || task.duration <= 0) throw new Error("Task duration must be a positive number of minutes.");
  const dates = [...new Set(nextAvailableDates)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date && date > task.date).sort();
  for (const date of dates) {
    const occupied = existing.filter((item) => item.date === date && item.status !== "SKIPPED" && item.id !== task.id);
    const used = occupied.reduce((sum, item) => sum + item.duration, 0);
    if (used + task.duration > 120) continue;
    const isWeekend = [0, 6].includes(new Date(`${date}T12:00:00`).getDay());
    const windows = [
      ...(isWeekend ? fixedWindows.slice(1) : fixedWindows),
      ...commitmentWindowsForDate(date, commitments),
    ];
    for (let start = 450; start + task.duration <= 1410; start += 1) {
      if (overlapsFixedWindow(start / 60, (start + task.duration) / 60, windows)) continue;
      if (occupied.some((item) => start < timeMinutes(item.end) && start + task.duration > timeMinutes(item.start))) continue;
      const part: PlannerTask = { ...task, id: `${task.id}-rescheduled`, date, start: clockTime(start), end: clockTime(start + task.duration), status: "TODO", skipReason: undefined };
      return [part];
    }
  }
  throw new Error("Not enough free time in the next 14 days to reschedule this session without shortening it. Your task has not been changed.");
}

export function timeMinutes(time: string) { const [h, m] = time.split(":").map(Number); return h * 60 + m; }
export function clockTime(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
export function formatTime12(time24: string): string {
  if (!time24 || !time24.includes(":")) return time24;
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return time24;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const mFormatted = String(m).padStart(2, "0");
  return `${h}:${mFormatted} ${ampm}`;
}
export function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function addDays(date: string, amount: number) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + amount); return localDate(value); }
export function weekDates(date: string) { const day = new Date(`${date}T12:00:00`).getDay(); const monday = addDays(date, -((day + 6) % 7)); return Array.from({ length: 7 }, (_, index) => addDays(monday, index)); }
export function formatMinutes(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
