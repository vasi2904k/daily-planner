"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit2,
  ListTodo,
  MoreVertical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sliders,
  Sparkles,
  Target,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  addDays,
  activeGoalTasks,
  scheduleEventsForDay,
  completionPercent,
  explicitDeadlineDays,
  explicitSessionDuration,
  formatMinutes,
  formatTime12,
  localDate,
  redistributeTask,
  scheduleGoalTasksPartial,
  type GoalTaskScheduleResult,
  weekDates,
  type PlannerTask,
} from "@/lib/scheduler";
import {
  addGoalWithTasks,
  addCommitment,
  deleteGoal,
  deleteCommitment,
  initialPlanner,
  parsePlanner,
  pauseGoal,
  pauseCommitment,
  resumeGoal,
  resumeCommitment,
  setTaskStatus,
  storageKey,
  updateGoal,
  type GoalItem,
  type CommitmentItem,
  type PlannerState,
} from "@/lib/planner-store";
import type { PlanOutput } from "@/lib/ai/schemas";
import { looksLikeCommitmentIntent } from "@/lib/goal-intent";

const subscribe = () => () => {};
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", options);

const HOURS_OPTIONS = ["30 min", "1 hour", "1–2 hours", "2–3 hours", "3+ hours", "It varies"];
const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIME_OF_DAY_OPTIONS = ["Morning", "Afternoon", "Evening", "Night", "Flexible"];
const COMMITMENT_TYPES: Array<{ value: CommitmentItem["type"]; label: string; icon: string }> = [
  { value: "work", label: "Work", icon: "💼" },
  { value: "college", label: "College", icon: "🎓" },
  { value: "gym", label: "Gym", icon: "🏋️" },
  { value: "commute", label: "Commute", icon: "🚆" },
  { value: "appointment", label: "Appointment", icon: "📅" },
  { value: "responsibility", label: "Personal", icon: "🏠" },
  { value: "other", label: "Other", icon: "📌" },
];
const LOADING_MESSAGES = [
  "Understanding your goal...",
  "Building your milestones...",
  "Fitting the plan around your schedule...",
  "Finalizing your plan...",
];

function scheduleTasksForPlan(
  plan: PlanOutput,
  goalDescription: string,
  deadlineDescription: string,
  goalId: string,
  startDateStr: string,
  preferredTime: string,
  daysAvailable: string[],
  existingTasks: PlannerTask[] = [],
  commitments: CommitmentItem[] = [],
  dailyMinutesLimit?: number,
): GoalTaskScheduleResult {
  const requestedDuration = explicitSessionDuration(goalDescription);
  const tasksToSchedule: Array<{
    title: string;
    category: string;
    duration: number;
    priority: "HIGH" | "MEDIUM" | "LOW";
    milestone: string;
  }> = [];

  for (const milestone of plan.milestones) {
    for (const task of milestone.tasks) {
      tasksToSchedule.push({
        title: task.title,
        category: milestone.title,
        duration: requestedDuration ?? task.estimatedMinutes,
        priority: task.priority || "MEDIUM",
        milestone: milestone.title,
      });
    }
  }

  if (tasksToSchedule.length === 0) {
    for (const day of plan.schedule) {
      for (const task of day.tasks) {
        tasksToSchedule.push({
          title: task.title,
          category: day.title,
          duration: (requestedDuration ?? task.estimatedMinutes) || 60,
          priority: "MEDIUM",
          milestone: day.title,
        });
      }
    }
  }

  return scheduleGoalTasksPartial(
    tasksToSchedule,
    goalId,
    startDateStr,
    preferredTime,
    daysAvailable,
    existingTasks,
    commitments,
    dailyMinutesLimit,
    Math.min(
      plan.durationDays ?? 365,
      explicitDeadlineDays(deadlineDescription, startDateStr)
        ?? explicitDeadlineDays(goalDescription, startDateStr)
        ?? 365,
    ),
  );
}

function dailyMinutesForSelection(selection: string): number | undefined {
  if (selection === "30 min") return 30;
  if (selection === "1 hour") return 60;
  if (selection === "1–2 hours") return 120;
  if (selection === "2–3 hours") return 180;
  return undefined;
}

export default function Home() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? (
    <Planner />
  ) : (
    <main className="content-area">
      <p role="status">Loading your planner…</p>
    </main>
  );
}

function Planner() {
  const [today, setToday] = useState(() => localDate());
  const [loaded] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const state = raw ? parsePlanner(raw) : initialPlanner(localDate());
      if (raw === null) localStorage.setItem(storageKey, JSON.stringify(state));
      return { state, error: "" };
    } catch {
      return {
        state: initialPlanner(localDate()),
        error:
          "Your saved planner could not be loaded. Changes will not be saved until you reset saved data.",
      };
    }
  });

  const [planner, setPlanner] = useState(loaded.state);
  const [storageError, setStorageError] = useState(loaded.error);
  const [storageBlocked, setStorageBlocked] = useState(Boolean(loaded.error));
  const [activeView, setActiveView] = useState("Today");

  // Goal & Detail view state
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [menuOpenGoalId, setMenuOpenGoalId] = useState<string | null>(null);
  const [goalToDelete, setGoalToDelete] = useState<GoalItem | null>(null);
  const [goalToEdit, setGoalToEdit] = useState<GoalItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState<"HIGH" | "MEDIUM" | "LOW">("MEDIUM");

  // Schedule view state
  const [scheduleViewMode, setScheduleViewMode] = useState<"week" | "today">("week");
  const [scheduleContentMode, setScheduleContentMode] = useState<"goals" | "commitments" | "combined">("goals");
  const [todayContentMode, setTodayContentMode] = useState<"goals" | "commitments" | "combined">("goals");
  const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0);

  // Fixed commitment form state
  const [showCommitmentForm, setShowCommitmentForm] = useState(false);
  const [commitmentTitle, setCommitmentTitle] = useState("");
  const [commitmentType, setCommitmentType] = useState<CommitmentItem["type"]>("work");
  const [commitmentDays, setCommitmentDays] = useState<string[]>(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  const [commitmentStartTime, setCommitmentStartTime] = useState("10:30");
  const [commitmentEndTime, setCommitmentEndTime] = useState("19:30");
  const [commitmentNotes, setCommitmentNotes] = useState("");

  // Goal Creation Flow State
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [flowStep, setFlowStep] = useState<"goal" | "availability" | "loading" | "preview">("goal");
  const [goalText, setGoalText] = useState("");
  const [goalDeadline, setGoalDeadline] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState("1–2 hours");
  const [selectedDays, setSelectedDays] = useState<string[]>([...ALL_DAYS]);
  const [preferredTime, setPreferredTime] = useState("Evening");
  const [difficulty, setDifficulty] = useState("moderate");
  const [generatedPlan, setGeneratedPlan] = useState<PlanOutput | null>(null);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [commitmentClarification, setCommitmentClarification] = useState(false);

  const [showModifyInput, setShowModifyInput] = useState(false);
  const [modifyPrompt, setModifyPrompt] = useState("");
  const [showDeadlineInput, setShowDeadlineInput] = useState(false);
  const [tempDeadline, setTempDeadline] = useState("");

  const [skipTask, setSkipTask] = useState<PlannerTask | null>(null);
  const [unscheduledGoalId, setUnscheduledGoalId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const goalEditor = useRef<HTMLElement>(null);
  const skipEditor = useRef<HTMLElement>(null);

  useEffect(() => {
    const editor = showGoalForm ? goalEditor.current : skipTask ? skipEditor.current : null;
    editor?.scrollIntoView({ block: "nearest" });
    if (skipTask) skipEditor.current?.focus();
  }, [showGoalForm, skipTask, flowStep]);

  useEffect(() => {
    const refresh = () => setToday(localDate());
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    if (!aiBusy) return;
    const interval = window.setInterval(() => {
      setLoadingMsgIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 1400);
    return () => window.clearInterval(interval);
  }, [aiBusy]);

  function save(next: PlannerState) {
    setPlanner(next);
    if (storageBlocked) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError("Browser storage is unavailable. Your changes are only available in this tab.");
    }
  }

  // Active goals and tasks filtering
  const activeTasks = activeGoalTasks(planner.tasks, planner.goals);

  // Today's chronological sessions from ALL active goals
  const todaySessions = activeTasks
    .filter(
      (task) =>
                  task.date === today && task.scheduleStatus !== "UNSCHEDULED" &&
        task.status !== "SKIPPED",
    )
    .sort((a, b) => a.start.localeCompare(b.start));

  const todayCommitments = planner.commitments
    .filter((commitment) => {
      if (commitment.status === "PAUSED") return false;
      const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(`${today}T12:00:00`)) as CommitmentItem["daysOfWeek"][number];
      return commitment.daysOfWeek.includes(dayName)
        && (!commitment.startDate || today >= commitment.startDate)
        && (!commitment.endDate || today <= commitment.endDate);
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const completedTodaySessions = todaySessions.filter((t) => t.status === "COMPLETED");
  const visibleTodaySessions = todayContentMode === "commitments" ? [] : todaySessions;
  const visibleTodayCommitments = todayContentMode === "goals" ? [] : todayCommitments;
  const todayEvents = [
    ...visibleTodaySessions.map((task) => ({ kind: "goal" as const, time: task.start, task })),
    ...visibleTodayCommitments.map((commitment) => ({ kind: "commitment" as const, time: commitment.startTime, commitment })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const scheduleTodayEvents = [
    ...(scheduleContentMode === "commitments" ? [] : todaySessions.map((task) => ({ kind: "goal" as const, time: task.start, task }))),
    ...(scheduleContentMode === "goals" ? [] : todayCommitments.map((commitment) => ({ kind: "commitment" as const, time: commitment.startTime, commitment }))),
  ].sort((a, b) => a.time.localeCompare(b.time));

  function advanceTask(id: string) {
    const target = planner.tasks.find((t) => t.id === id);
    if (!target) return;
    const nextStatus = target.status === "TODO"
      ? "IN_PROGRESS"
      : target.status === "IN_PROGRESS"
        ? "COMPLETED"
        : "TODO";
    save(setTaskStatus(planner, id, nextStatus));
    setToast(nextStatus === "IN_PROGRESS" ? "Session started." : nextStatus === "COMPLETED" ? "Session completed! Great work." : "Session moved back to your plan.");
  }

  function skipWithReason(reason: string) {
    if (!skipTask) return;
    try {
      const future = Array.from({ length: 14 }, (_, index) =>
        addDays(today > skipTask.date ? today : skipTask.date, index + 1),
      );
      const replacements = redistributeTask(skipTask, future, activeTasks, planner.commitments);
      save({
        ...planner,
        tasks: [
          ...planner.tasks.map((task) =>
            task.id === skipTask.id
              ? { ...task, status: "SKIPPED" as const, skipReason: reason }
              : task,
          ),
          ...replacements,
        ],
      });
      setSkipTask(null);
      setToast(
        `Rescheduled ${skipTask.duration} minutes into ${replacements.length} sessions. Reason: ${reason}.`,
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to reschedule this task.");
    }
  }

  function toggleDay(day: string) {
    setSelectedDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length <= 1) return prev;
        return prev.filter((d) => d !== day);
      }
      return [...prev, day];
    });
  }

  async function generatePlanCall(customOverride?: {
    deadline?: string;
    difficulty?: string;
    modificationPrompt?: string;
  }) {
    if (!goalText.trim()) return;
    setAiBusy(true);
    setAiError("");
    setFlowStep("loading");

    try {
      const response = await fetch("/api/ai/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goalText.trim(),
          deadline: customOverride?.deadline ?? goalDeadline.trim(),
          hoursPerDay,
          daysAvailable: selectedDays,
          preferredTime,
          difficulty: customOverride?.difficulty ?? difficulty,
          modificationPrompt: customOverride?.modificationPrompt,
        }),
      });

      const result = (await response.json()) as PlanOutput & { error?: string };
      if (!response.ok || result.error) {
        throw new Error(result.error || "We couldn't generate your plan right now. Please try again.");
      }

      setGeneratedPlan(result);
      setFlowStep("preview");
      setShowModifyInput(false);
      setShowDeadlineInput(false);
      setModifyPrompt("");
    } catch {
      setAiError("We couldn't generate your plan right now. Please try again.");
      setFlowStep("loading");
    } finally {
      setAiBusy(false);
    }
  }

  function handleStartPlan() {
    if (!generatedPlan) return;
    const newGoalId = crypto.randomUUID();
    const finalTitle = generatedPlan.goal?.trim() || goalText.trim();
    let scheduleResult: GoalTaskScheduleResult;
    try {
      scheduleResult = scheduleTasksForPlan(
        generatedPlan,
        goalText,
        goalDeadline,
        newGoalId,
        today,
        preferredTime,
        selectedDays,
        planner.tasks,
        planner.commitments,
        dailyMinutesForSelection(hoursPerDay),
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No available time remains for this plan.");
      return;
    }
    if (process.env.NODE_ENV === "development") {
      console.info("[Scheduler candidate diagnostics]", {
        goal: finalTitle,
        startDate: today,
        preferredTime,
        selectedDays,
        dailyMinutesLimit: dailyMinutesForSelection(hoursPerDay) ?? null,
        deadline: goalDeadline || generatedPlan.durationDays || "none",
        searchWindow: scheduleResult.searchWindow,
        candidates: scheduleResult.candidateDiagnostics,
      });
    }

    const invalidTasks = scheduleResult.scheduledTasks.filter((task) => task.goalId !== newGoalId);
    if (invalidTasks.length > 0 && process.env.NODE_ENV === "development") {
      console.error(`Excluded ${invalidTasks.length} scheduled task(s) with an unexpected goalId.`);
    }
    const scheduled = scheduleResult.scheduledTasks.filter((task) => task.goalId === newGoalId);
    const unscheduled: PlannerTask[] = scheduleResult.unscheduledTasks
      .filter((task) => task.goalId === newGoalId)
      .map((task, index) => ({
        ...task,
        id: `unscheduled-${newGoalId}-${index + 1}`,
        date: today,
        start: "00:00",
        end: "00:00",
        status: "TODO",
        scheduleStatus: "UNSCHEDULED",
      }));

    save(
      addGoalWithTasks(planner, finalTitle, newGoalId, [...scheduled, ...unscheduled], {
        priority: "MEDIUM",
        deadline: goalDeadline.trim() || undefined,
      }),
    );

    setShowGoalForm(false);
    setFlowStep("goal");
    setGoalText("");
    setGoalDeadline("");
    setGeneratedPlan(null);
    setSelectedGoalId(newGoalId);
    setActiveView(unscheduled.length ? "Goals" : "Today");
    setToast(`${scheduled.length} sessions scheduled. ${unscheduled.length} ${unscheduled.length === 1 ? "session couldn't" : "sessions couldn't"} be scheduled.`);
    if (unscheduled.length) setUnscheduledGoalId(newGoalId);
  }

  function openNewGoal() {
    setFlowStep("goal");
    setGoalText("");
    setGoalDeadline("");
    setGeneratedPlan(null);
    setAiError("");
    setCommitmentClarification(false);
    setShowGoalForm(true);
  }

  function continueGoalSetup() {
    if (looksLikeCommitmentIntent(goalText)) {
      setCommitmentClarification(true);
      return;
    }
    setCommitmentClarification(false);
    setFlowStep("availability");
  }

  function openNewCommitment() {
    setCommitmentTitle("");
    setCommitmentType("work");
    setCommitmentDays(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    setCommitmentStartTime("10:30");
    setCommitmentEndTime("19:30");
    setCommitmentNotes("");
    setShowGoalForm(false);
    setShowCommitmentForm(true);
  }

  function toggleCommitmentDay(day: string) {
    setCommitmentDays((previous) => previous.includes(day)
      ? previous.filter((selected) => selected !== day)
      : [...previous, day]);
  }

  function handleSaveCommitment() {
    if (!commitmentTitle.trim() || commitmentDays.length === 0) return;
    const typeInfo = COMMITMENT_TYPES.find((type) => type.value === commitmentType);
    const commitment: CommitmentItem = {
      id: crypto.randomUUID(),
      title: commitmentTitle.trim(),
      type: commitmentType,
      daysOfWeek: commitmentDays as CommitmentItem["daysOfWeek"],
      startTime: commitmentStartTime,
      endTime: commitmentEndTime,
      notes: commitmentNotes.trim(),
      color: "#2563eb",
      icon: typeInfo?.icon || "📌",
      status: "ACTIVE",
    };
    try {
      save(addCommitment(planner, commitment));
      setShowCommitmentForm(false);
      setActiveView("Schedule");
      setScheduleContentMode("commitments");
      setToast(`Added "${commitment.title}" as a fixed commitment.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to save this commitment.");
    }
  }

  function handleDeleteCommitment(commitment: CommitmentItem) {
    save(deleteCommitment(planner, commitment.id));
    setToast(`Deleted "${commitment.title}". Goals and sessions were not changed.`);
  }

  function handleToggleCommitment(commitment: CommitmentItem) {
    save(commitment.status === "PAUSED"
      ? resumeCommitment(planner, commitment.id)
      : pauseCommitment(planner, commitment.id));
  }

  // Goal deletion
  function confirmDeleteGoal() {
    if (!goalToDelete) return;
    const targetId = goalToDelete.id;
    const targetTitle = goalToDelete.title;
    const nextState = deleteGoal(planner, targetId);
    save(nextState);
    if (selectedGoalId === targetId) setSelectedGoalId(null);
    setGoalToDelete(null);
    setToast(`Deleted "${targetTitle}" and its scheduled tasks.`);
  }

  // Goal pause / resume
  function handleTogglePause(goalId: string) {
    const target = planner.goals.find((g) => g.id === goalId);
    if (!target) return;
    const isPaused = target.status === "PAUSED";
    const nextState = isPaused ? resumeGoal(planner, goalId) : pauseGoal(planner, goalId);
    save(nextState);
    setMenuOpenGoalId(null);
    setToast(isPaused ? `Resumed "${target.title}".` : `Paused "${target.title}".`);
  }

  function resolveUnscheduled(action: "extend" | "increase" | "reduce" | "keep") {
    if (!unscheduledGoalId) return;
    const goal = planner.goals.find((item) => item.id === unscheduledGoalId);
    const pending = planner.tasks.filter((task) => task.goalId === unscheduledGoalId && task.scheduleStatus === "UNSCHEDULED");
    if (!goal || pending.length === 0) { setUnscheduledGoalId(null); return; }
    if (action === "keep") { setUnscheduledGoalId(null); return; }
    if (action === "reduce") {
      save({ ...planner, tasks: planner.tasks.map((task) => pending.some((item) => item.id === task.id) ? { ...task, status: "SKIPPED" as const, skipReason: "User chose to reduce workload" } : task) });
      setUnscheduledGoalId(null);
      setToast("Unscheduled work kept with this goal and marked skipped at your request.");
      return;
    }
    const days = Math.max(14, explicitDeadlineDays(goal.deadline ?? "", today) ?? 14) + (action === "extend" ? 14 : 0);
    const dailyLimit = (dailyMinutesForSelection(hoursPerDay) ?? 120) + (action === "increase" ? 30 : 0);
    const pendingIds = new Set(pending.map((task) => task.id));
    const otherTasks = planner.tasks.filter((task) => !pendingIds.has(task.id));
    const result = scheduleGoalTasksPartial(
      pending.map(({ title, category, duration, priority, milestone }) => ({ title, category, duration, priority, milestone })),
      goal.id, today, preferredTime, [...ALL_DAYS], otherTasks, planner.commitments, dailyLimit, days,
    );
    if (process.env.NODE_ENV === "development") {
      console.info("[Scheduler candidate diagnostics]", { goal: goal.title, action, startDate: today, preferredTime, dailyMinutesLimit: dailyLimit, searchWindow: result.searchWindow, candidates: result.candidateDiagnostics });
    }
    const newScheduled = result.scheduledTasks.map((task) => {
      const original = pending.find((item) => item.title === task.title && item.duration === task.duration);
      return { ...task, id: original?.id ?? task.id, goalId: goal.id };
    });
    const scheduledIds = new Set(newScheduled.map((task) => task.id));
    const remainingIds = new Set(result.unscheduledTasks.map((item) => pending.find((task) => task.title === item.title && task.duration === item.duration)?.id).filter((id): id is string => Boolean(id)));
    const replacement = planner.tasks.flatMap((task) => {
      if (scheduledIds.has(task.id)) return newScheduled.filter((item) => item.id === task.id);
      if (pendingIds.has(task.id) && !remainingIds.has(task.id)) return [];
      return [task];
    });
    save({ ...planner, tasks: replacement });
    if (remainingIds.size === 0) {
      setUnscheduledGoalId(null);
      setToast(`${newScheduled.length} previously unscheduled ${newScheduled.length === 1 ? "session is" : "sessions are"} now scheduled.`);
    } else {
      setUnscheduledGoalId(goal.id);
      setToast(`${newScheduled.length} sessions scheduled. ${remainingIds.size} ${remainingIds.size === 1 ? "session remains" : "sessions remain"} unscheduled.`);
    }
  }

  // Goal edit
  function handleOpenEdit(g: GoalItem) {
    setGoalToEdit(g);
    setEditTitle(g.title);
    setEditPriority(g.priority || "MEDIUM");
    setMenuOpenGoalId(null);
  }

  function handleSaveEdit() {
    if (!goalToEdit || !editTitle.trim()) return;
    const nextState = updateGoal(planner, goalToEdit.id, {
      title: editTitle.trim(),
      priority: editPriority,
    });
    save(nextState);
    setGoalToEdit(null);
    setToast(`Updated "${editTitle.trim()}".`);
  }

  // Selected goal detail object
  const selectedGoal = planner.goals.find((g) => g.id === selectedGoalId);
  const selectedGoalTasks = selectedGoal
    ? planner.tasks.filter((t) => t.goalId === selectedGoal.id)
    : [];
  const selectedUnscheduledTasks = selectedGoalTasks.filter((task) => task.scheduleStatus === "UNSCHEDULED" && task.status !== "SKIPPED");

  // Schedule week dates
  const weekBaseDate = addDays(today, scheduleWeekOffset * 7);
  const currentWeekDates = weekDates(weekBaseDate);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || activeView !== "Schedule") return;
    const pendingGoalIds = [...new Set(planner.tasks
      .filter((task) => task.scheduleStatus === "UNSCHEDULED" && task.status !== "SKIPPED")
      .map((task) => task.goalId)
      .filter((goalId): goalId is string => Boolean(goalId)))];
    for (const goalId of pendingGoalIds) {
      const goal = planner.goals.find((item) => item.id === goalId);
      const pending = planner.tasks.filter((task) => task.goalId === goalId && task.scheduleStatus === "UNSCHEDULED" && task.status !== "SKIPPED");
      if (!goal || pending.length === 0) continue;
      const maxDays = explicitDeadlineDays(goal.deadline ?? "", today) ?? 365;
      const diagnostic = scheduleGoalTasksPartial(
        pending.map(({ title, category, duration, priority, milestone }) => ({ title, category, duration, priority, milestone })),
        goalId,
        today,
        preferredTime,
        selectedDays,
        planner.tasks.filter((task) => !(task.goalId === goalId && task.scheduleStatus === "UNSCHEDULED")),
        planner.commitments,
        dailyMinutesForSelection(hoursPerDay),
        maxDays,
      );
      console.info("[Scheduler pending-task dry run; no planner changes made]", {
        goal: { id: goal.id, title: goal.title, status: goal.status },
        inputs: {
          startDate: today,
          preferredTime,
          selectedDays,
          dailyMinutesLimit: dailyMinutesForSelection(hoursPerDay) ?? null,
          deadline: goal.deadline ?? "none",
          searchWindow: diagnostic.searchWindow,
        },
        tasks: pending.map(({ id, goalId: taskGoalId, title, date, start, end, status, duration }) => ({ id, goalId: taskGoalId, title, date, startTime: start, endTime: end, status, duration })),
        candidates: diagnostic.candidateDiagnostics,
      });
    }
  }, [activeView, planner, today, preferredTime, selectedDays, hoursPerDay]);

  return (
    <main
      className="app-shell"
      onClick={() => {
        if (menuOpenGoalId) setMenuOpenGoalId(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setShowGoalForm(false);
          setShowCommitmentForm(false);
          setSkipTask(null);
          setGoalToDelete(null);
          setGoalToEdit(null);
          setMenuOpenGoalId(null);
        }
      }}
    >
      {/* ── Navigation Sidebar ─────────────────────────────────────────── */}
      <aside id="planner-navigation" className="sidebar">
        <div className="brand-mark">
          <span>DS</span>
          <div>
            <strong>Daily</strong>
            <small>Scheduler</small>
          </div>
        </div>

        <nav aria-label="Main navigation">
          {[
            { label: "Today", icon: CalendarCheck },
            { label: "Goals", icon: Target },
            { label: "Schedule", icon: CalendarDays },
            { label: "Progress", icon: ListTodo },
          ].map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${activeView === label && !selectedGoalId ? "active" : ""}`}
              aria-current={activeView === label && !selectedGoalId ? "page" : undefined}
              onClick={() => {
                setActiveView(label);
                setSelectedGoalId(null);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <p className="heading-note">Personal AI Planner</p>
          <p className="heading-note">
            {planner.goals.filter((g) => g.status !== "PAUSED").length} Active Goals
          </p>
        </div>
      </aside>

      <section className="content-area">
        {/* ── Top Bar ──────────────────────────────────────────────────── */}
        <header className="topbar">
          <div className="breadcrumb">
            {dateLabel(today, { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" onClick={openNewCommitment}>
              <Plus size={16} /> Add Commitment
            </button>
            <button className="new-goal" onClick={openNewGoal}>
              <Plus size={16} /> New goal
            </button>
          </div>
        </header>

        {storageError && (
          <div className="recovery-note" role="alert">
            <p>{storageError}</p>
            {storageBlocked && (
              <button
                onClick={() => {
                  try {
                    localStorage.setItem(storageKey, JSON.stringify(planner));
                    setStorageBlocked(false);
                    setStorageError("");
                  } catch {
                    setStorageError("Browser storage is unavailable.");
                  }
                }}
              >
                Reset saved data
              </button>
            )}
          </div>
        )}

        {/* ── Heading ──────────────────────────────────────────────────── */}
        {!selectedGoalId && (
          <div className="page-heading">
            <div>
              <h1>{activeView === "Today" ? "Today" : activeView}</h1>
              <p className="heading-note">
                {activeView === "Today" && "Your day in one glance — clear, calm, and actionable."}
                {activeView === "Goals" && "Track, customize, and manage your active goals."}
                {activeView === "Schedule" && "View when your sessions happen across the week."}
                {activeView === "Progress" && "See your momentum across all goals."}
              </p>
            </div>
            <div className="date-stamp">
              <span>{dateLabel(today, { weekday: "short" })}</span>
              <strong>{Number(today.slice(8))}</strong>
              <small>{dateLabel(today, { month: "short", year: "numeric" })}</small>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            1. TODAY DASHBOARD (DEFAULT / HOME VIEW)
            ══════════════════════════════════════════════════════════════════ */}
        {activeView === "Today" && !selectedGoalId && (
          <div className="today-dashboard">
            <div className="today-view-controls">
              <div className="view-switch" aria-label="Today content">
                {(["goals", "commitments", "combined"] as const).map((mode) => (
                  <button key={mode} className={todayContentMode === mode ? "selected" : ""} aria-pressed={todayContentMode === mode} onClick={() => setTodayContentMode(mode)}>
                    {mode === "goals" ? "Goals" : mode === "commitments" ? "Commitments" : "Combined"}
                  </button>
                ))}
              </div>
              <span>{todayContentMode === "goals" ? "Things you want to accomplish" : todayContentMode === "commitments" ? "Things already on your calendar" : "Your complete day"}</span>
            </div>
            <div className="today-summary-bar">
              <span>
                {todayEvents.length === 0
                  ? `No ${todayContentMode === "commitments" ? "commitments" : "sessions"} scheduled today`
                  : todayContentMode === "commitments"
                    ? `${visibleTodayCommitments.length} commitments today`
                    : `${completedTodaySessions.length} of ${visibleTodaySessions.length} sessions completed`}
              </span>
              <span>
                {todayContentMode === "commitments"
                  ? `${visibleTodayCommitments.length} fixed blocks`
                  : `${formatMinutes(visibleTodaySessions.reduce((sum, t) => sum + t.duration, 0))} planned today`}
              </span>
            </div>

            {todayEvents.length === 0 ? (
              <div className="empty-today-box">
                <span className="empty-today-icon">🎉</span>
                <h3>{todayContentMode === "commitments" ? "No commitments today" : "You're all clear today"}</h3>
                <p>
                  {todayContentMode === "commitments" ? "Add your work, study, or other recurring routine here." : "No scheduled goal sessions for today. Take time to rest, review, or plan ahead."}
                </p>
                <button className="primary-button" onClick={todayContentMode === "commitments" ? openNewCommitment : openNewGoal}>
                  <Plus size={16} /> {todayContentMode === "commitments" ? "Add Commitment" : "Add Goal"}
                </button>
              </div>
            ) : (
              <div className="today-sessions-list">
                {todayEvents.map((event) => {
                  if (event.kind === "commitment") {
                    const commitment = event.commitment;
                    return (
                      <article key={commitment.id} className="today-session-card commitment-session">
                        <div className="session-content">
                          <div className="session-goal-header">
                            <span className="session-time-badge">{formatTime12(commitment.startTime)} - {formatTime12(commitment.endTime)}</span>
                            <span className="schedule-kind-label commitment-label">COMMITMENT</span>
                          </div>
                          <h3>{commitment.icon} {commitment.title}</h3>
                          <div className="session-sub-info">{commitment.daysOfWeek.join(", ")}{commitment.notes ? ` · ${commitment.notes}` : ""}</div>
                        </div>
                      </article>
                    );
                  }
                  const task = event.task;
                  const goalInfo = planner.goals.find((g) => g.id === task.goalId);
                  const isDone = task.status === "COMPLETED";

                  return (
                    <article
                      key={task.id}
                      className={`today-session-card ${isDone ? "is-done" : ""}`}
                      style={{ borderLeftColor: goalInfo?.color || "var(--green)" }}
                    >
                      <div className="session-content">
                        <div className="session-goal-header">
                          <span className="schedule-kind-label goal-label">GOAL</span>
                          <span className="session-goal-tag">
                            <span className="goal-color-dot" style={{ backgroundColor: goalInfo?.color || "var(--green)" }} aria-hidden="true" />
                            <span>{goalInfo?.emoji || "🎯"}</span>
                            <span>{goalInfo?.title || "Goal"}</span>
                          </span>
                          <span className="session-time-badge">
                            {formatTime12(task.start)} – {formatTime12(task.end)}
                          </span>
                        </div>

                        <h3>{task.title}</h3>

                        <div className="session-sub-info">
                          <span>
                            <Clock size={12} style={{ display: "inline", marginRight: "4px" }} />
                            {task.duration} min
                          </span>
                        </div>
                      </div>

                      <div className="session-actions-cell">
                        {isDone ? (
                          <button
                            className="btn-completed-toggle"
                            title="Click to return this session to your plan"
                            onClick={() => advanceTask(task.id)}
                          >
                            <Check size={14} /> Completed
                          </button>
                        ) : (
                          <>
                            <button
                              className="btn-start-session"
                              onClick={() => advanceTask(task.id)}
                            >
                              {task.status === "IN_PROGRESS" ? <Check size={14} /> : <Play size={14} />}
                              {task.status === "IN_PROGRESS" ? "Mark complete" : "Start session"}
                            </button>
                            {task.status === "TODO" && <button
                              className="skip-button"
                              onClick={() => setSkipTask(task)}
                              title="Reschedule session"
                            >
                              Skip
                            </button>}
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            2. GOALS PAGE
            ══════════════════════════════════════════════════════════════════ */}
        {activeView === "Goals" && !selectedGoalId && (
          <div className="goals-page-container">
            <div className="section-head">
              <div>
                <h2>Your Goals</h2>
                <p>
                  {planner.goals.length} {planner.goals.length === 1 ? "goal" : "goals"} in your
                  planner
                </p>
              </div>
              <button className="primary-button" onClick={openNewGoal}>
                <Plus size={16} /> New goal
              </button>
            </div>

            <div className="goals-grid">
              {planner.goals.length === 0 && (
                <div className="empty-goals-state">
                  <h3>Start with one goal</h3>
                  <p>Tell us what you want to work toward. We’ll fit the sessions around your availability.</p>
                  <button className="primary-button" onClick={openNewGoal}>
                    <Plus size={16} /> Add a goal
                  </button>
                </div>
              )}
              {planner.goals.map((g) => {
                const gTasks = planner.tasks.filter((t) => t.goalId === g.id);
                const percent = completionPercent(gTasks);
                const isPaused = g.status === "PAUSED";
                const todayTask = gTasks.find(
                  (t) => t.date === today && t.status !== "SKIPPED",
                );

                return (
                  <article key={g.id} className="goal-card-item">
                    <div className="goal-card-top-row">
                      <div className="goal-card-title-group">
                        <span className="goal-card-emoji" style={{ color: g.color }}>{g.emoji || "🎯"}</span>
                        <div>
                          <h3>{g.title}</h3>
                          <div className="badge-row" style={{ marginTop: "4px" }}>
                            {isPaused ? (
                              <span className="badge-status-paused">Paused</span>
                            ) : (
                              <span className={`badge-priority ${g.priority || "MEDIUM"}`}>
                                {g.priority || "MEDIUM"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* ••• Menu */}
                      <div className="goal-menu-anchor" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn-dots-menu"
                          aria-label="Goal options"
                          aria-haspopup="true"
                          aria-expanded={menuOpenGoalId === g.id}
                          onClick={() =>
                            setMenuOpenGoalId(menuOpenGoalId === g.id ? null : g.id)
                          }
                        >
                          <MoreVertical size={18} />
                        </button>

                        {menuOpenGoalId === g.id && (
                          <div className="goal-dropdown-menu">
                            <button
                              className="goal-dropdown-item"
                              onClick={() => {
                                setSelectedGoalId(g.id);
                                setMenuOpenGoalId(null);
                              }}
                            >
                              <Target size={14} /> View Plan
                            </button>
                            <button
                              className="goal-dropdown-item"
                              onClick={() => handleOpenEdit(g)}
                            >
                              <Edit2 size={14} /> Edit Goal
                            </button>
                            <button
                              className="goal-dropdown-item"
                              onClick={() => handleTogglePause(g.id)}
                            >
                              {isPaused ? <Play size={14} /> : <Pause size={14} />}
                              {isPaused ? "Resume Goal" : "Pause Goal"}
                            </button>
                            <button
                              className="goal-dropdown-item danger"
                              onClick={() => {
                                setGoalToDelete(g);
                                setMenuOpenGoalId(null);
                              }}
                            >
                              <Trash2 size={14} /> Delete Goal
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="goal-card-progress">
                      <div className="goal-card-progress-labels">
                        <span>{percent}% complete</span>
                      </div>
                      <div className="progress-track">
                        <span style={{ width: `${percent}%` }} />
                      </div>
                    </div>

                    {/* Today snippet */}
                    <div className="goal-today-card-box">
                      <strong>Today</strong>
                      <p>
                        {isPaused
                          ? "Goal is paused."
                          : todayTask
                            ? `${todayTask.title} (${formatTime12(todayTask.start)})`
                            : "No session today."}
                      </p>
                    </div>

                    <div className="goal-card-footer">
                      <button
                        className="text-button"
                        onClick={() => setSelectedGoalId(g.id)}
                      >
                        View Plan <ArrowRight size={14} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            3. GOAL DETAIL VIEW
            ══════════════════════════════════════════════════════════════════ */}
        {selectedGoal && (
          <div className="goal-detail-view">
            <div className="goal-detail-topbar">
              <button
                className="btn-back-link"
                onClick={() => setSelectedGoalId(null)}
              >
                <ArrowLeft size={16} /> Back to Goals
              </button>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="secondary-button"
                  onClick={() => handleOpenEdit(selectedGoal)}
                >
                  <Edit2 size={14} /> Edit
                </button>
                <button
                  className="secondary-button"
                  onClick={() => handleTogglePause(selectedGoal.id)}
                >
                  {selectedGoal.status === "PAUSED" ? (
                    <>
                      <Play size={14} /> Resume
                    </>
                  ) : (
                    <>
                      <Pause size={14} /> Pause
                    </>
                  )}
                </button>
                <button
                  className="danger-button"
                  onClick={() => setGoalToDelete(selectedGoal)}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>

            {/* Header Hero */}
            <div className="goal-detail-header-card">
              <div className="goal-detail-title-area">
                <span style={{ fontSize: "32px" }}>{selectedGoal.emoji || "🎯"}</span>
                <div>
                  <h2>{selectedGoal.title}</h2>
                  <div className="badge-row" style={{ marginTop: "6px" }}>
                    {selectedGoal.status === "PAUSED" ? (
                      <span className="badge-status-paused">Paused</span>
                    ) : (
                      <span
                        className={`badge-priority ${selectedGoal.priority || "MEDIUM"}`}
                      >
                        Priority: {selectedGoal.priority || "MEDIUM"}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="goal-detail-stats-grid">
                <div className="stat-mini-box">
                  <span>Progress</span>
                  <strong>{completionPercent(selectedGoalTasks)}%</strong>
                </div>
                <div className="stat-mini-box">
                  <span>Sessions Completed</span>
                  <strong>
                    {selectedGoalTasks.filter((t) => t.status === "COMPLETED").length} /{" "}
                    {selectedGoalTasks.length}
                  </strong>
                </div>
                <div className="stat-mini-box">
                  <span>Deadline</span>
                  <strong>{selectedGoal.deadline || "Not set"}</strong>
                </div>
              </div>
            </div>

            {/* Today Session */}
            <div className="plan-block">
              <div className="plan-block-title">Today</div>
              {(() => {
                const todayTask = selectedGoalTasks.find(
                  (t) => selectedGoal.status !== "PAUSED" && t.date === today && t.status !== "SKIPPED" && t.scheduleStatus !== "UNSCHEDULED",
                );
                if (!todayTask) {
                  return <p className="heading-note">No session scheduled for today.</p>;
                }
                const isDone = todayTask.status === "COMPLETED";
                return (
                  <div
                    className="today-session-card"
                    style={{
                      marginTop: "8px",
                      borderLeftColor: selectedGoal.color || "var(--green)",
                    }}
                  >
                    <div>
                      <span className="session-time-badge">
                        {formatTime12(todayTask.start)} – {formatTime12(todayTask.end)}
                      </span>
                      <h3>{todayTask.title}</h3>
                      <span className="session-sub-info">{todayTask.duration} min</span>
                    </div>
                    <div>
                      <button
                        className={isDone ? "btn-completed-toggle" : "btn-start-session"}
                        onClick={() => advanceTask(todayTask.id)}
                      >
                        {isDone ? <Check size={14} /> : todayTask.status === "TODO" ? <Play size={14} /> : <Check size={14} />}
                        {isDone ? "Completed" : todayTask.status === "TODO" ? "Start session" : "Mark complete"}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Up Next */}
            <div className="plan-block">
              <div className="plan-block-title">Up Next</div>
              {(() => {
                const upcoming = selectedGoalTasks
                  .filter((t) => selectedGoal.status !== "PAUSED" && t.date > today && t.status !== "SKIPPED" && t.scheduleStatus !== "UNSCHEDULED")
                  .slice(0, 3);

                if (upcoming.length === 0) {
                  return (
                    <p className="heading-note">
                      No upcoming sessions left in this plan. Excellent progress!
                    </p>
                  );
                }

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {upcoming.map((t) => (
                      <div
                        key={t.id}
                        className="plan-task-row"
                        style={{
                          padding: "10px",
                          borderRadius: "6px",
                          border: "1px solid var(--line)",
                          background: "var(--paper)",
                        }}
                      >
                        <div>
                          <strong>{t.title}</strong>
                          <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                            {t.date === today
                              ? "Today"
                              : dateLabel(t.date, { weekday: "short", month: "short", day: "numeric" })}{" "}
                            · {formatTime12(t.start)} · {t.duration}m
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {selectedUnscheduledTasks.length > 0 && (
            <div className="plan-block">
                <div className="plan-block-title">Unscheduled sessions</div>
                <p className="heading-note">These tasks remain attached to this goal and keep their requested duration.</p>
                {selectedUnscheduledTasks.map((task) => (
                  <div key={task.id} className="plan-task-row">
                    <span>{task.title}</span><strong>{task.duration} min</strong>
                  </div>
                ))}
                <div className="reason-grid">
                  <button onClick={() => resolveUnscheduled("extend")}>Extend Deadline</button>
                  <button onClick={() => resolveUnscheduled("increase")}>Increase Availability</button>
                  <button onClick={() => resolveUnscheduled("reduce")}>Reduce Workload</button>
                  <button onClick={() => resolveUnscheduled("keep")}>Keep Unscheduled</button>
                </div>
              </div>
            )}

            {/* Milestones Stepper */}
            <div className="plan-block">
              <div className="plan-block-title">Milestones</div>
              <div className="milestone-stepper">
                {(() => {
                  const milestones = Array.from(
                    new Set(selectedGoalTasks.map((t) => t.milestone).filter(Boolean)),
                  );

                  return milestones.map((mName, idx) => {
                    const mTasks = selectedGoalTasks.filter((t) => t.milestone === mName);
                    const allDone = mTasks.every((t) => t.status === "COMPLETED");
                    const someDone = mTasks.some((t) => t.status === "COMPLETED");

                    let iconState = "upcoming";
                    if (allDone) iconState = "done";
                    else if (someDone) iconState = "current";

                    return (
                      <div key={idx} className="milestone-step-item">
                        <div className={`milestone-step-icon ${iconState}`}>
                          {allDone ? "✓" : someDone ? "→" : "○"}
                        </div>
                        <div style={{ flex: 1 }}>
                          <strong style={{ fontSize: "13px" }}>{mName}</strong>
                          <span
                            style={{
                              display: "block",
                              fontSize: "11px",
                              color: "var(--muted)",
                              marginTop: "2px",
                            }}
                          >
                            {mTasks.filter((t) => t.status === "COMPLETED").length} of{" "}
                            {mTasks.length} tasks completed
                          </span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            <div>
              <button
                className="secondary-button"
                onClick={() => {
                  setActiveView("Schedule");
                  setSelectedGoalId(null);
                }}
              >
                <CalendarDays size={14} /> View in Full Schedule
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            4. SCHEDULE PAGE (WEEK & TODAY TABS)
            ══════════════════════════════════════════════════════════════════ */}
        {activeView === "Schedule" && !selectedGoalId && (
          <div className="schedule-page-container">
            <div className="schedule-tabs-bar">
              <div className="view-switch">
                <button
                  className={scheduleViewMode === "week" ? "selected" : ""}
                  onClick={() => setScheduleViewMode("week")}
                >
                  Week
                </button>
                <button
                  className={scheduleViewMode === "today" ? "selected" : ""}
                  onClick={() => setScheduleViewMode("today")}
                >
                  Today
                </button>
              </div>

              {scheduleViewMode === "week" && (
                <div className="week-nav-group">
                  <button
                    className="secondary-button"
                    onClick={() => setScheduleWeekOffset(scheduleWeekOffset - 1)}
                  >
                    <ChevronLeft size={16} /> Prev
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setScheduleWeekOffset(0)}
                  >
                    This Week
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setScheduleWeekOffset(scheduleWeekOffset + 1)}
                  >
                    Next <ChevronRight size={16} />
                  </button>
                  <span>
                    {dateLabel(currentWeekDates[0], { month: "short", day: "numeric" })} –{" "}
                    {dateLabel(currentWeekDates[6], {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>

            <div className="schedule-tabs-bar" style={{ marginTop: "12px" }}>
              <div className="view-switch" aria-label="Schedule content">
                {(["goals", "commitments", "combined"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={scheduleContentMode === mode ? "selected" : ""}
                    aria-pressed={scheduleContentMode === mode}
                    onClick={() => setScheduleContentMode(mode)}
                  >
                    {mode === "goals" ? "Goals" : mode === "commitments" ? "Commitments" : "Combined"}
                  </button>
                ))}
              </div>
              <button className="primary-button" onClick={openNewCommitment}>
                <Plus size={15} /> Add Commitment
              </button>
            </div>
            <p className="schedule-mode-caption">
              {scheduleContentMode === "goals" ? "Things you want to accomplish" : scheduleContentMode === "commitments" ? "Things already on your calendar" : "Your complete day, in time order"}
            </p>

            {scheduleContentMode === "commitments" && planner.commitments.length > 0 && (
              <div className="view-section" style={{ marginTop: "14px" }}>
                <div className="section-head">
                  <div>
                    <h2>Fixed commitments</h2>
                    <p>These blocks are user-owned constraints. They are never generated by AI.</p>
                  </div>
                </div>
                <div className="goals-grid">
                  {planner.commitments.map((commitment) => (
                    <article key={commitment.id} className="goal-card-item">
                      <div className="goal-card-top-row">
                        <div className="goal-card-title-group">
                          <span className="goal-card-emoji">{commitment.icon}</span>
                          <div>
                            <h3>{commitment.title}</h3>
                            <p className="heading-note">{commitment.daysOfWeek.join(", ")} · {formatTime12(commitment.startTime)}–{formatTime12(commitment.endTime)}</p>
                          </div>
                        </div>
                        <span className={commitment.status === "PAUSED" ? "badge-status-paused" : "badge-priority MEDIUM"}>
                          {commitment.status === "PAUSED" ? "Paused" : "Active"}
                        </span>
                      </div>
                      <div className="modal-actions-row" style={{ justifyContent: "flex-start", marginTop: "12px" }}>
                        <button className="secondary-button" onClick={() => handleToggleCommitment(commitment)}>
                          {commitment.status === "PAUSED" ? <Play size={14} /> : <Pause size={14} />}
                          {commitment.status === "PAUSED" ? "Resume" : "Pause"}
                        </button>
                        <button className="danger-button" onClick={() => handleDeleteCommitment(commitment)}>
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {scheduleViewMode === "week" ? (
              <div className="schedule-preview-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                {currentWeekDates.map((date) => {
                  const dayEvents = scheduleEventsForDay(planner.tasks, planner.goals, planner.commitments, date, scheduleContentMode);

                  const isCurrentDay = date === today;

                  return (
                    <div
                      key={date}
                      className="schedule-day-column"
                      style={isCurrentDay ? { borderColor: "var(--green)", background: "rgba(53,107,82,.04)" } : {}}
                    >
                      <div className="schedule-day-header">
                        <strong>{dateLabel(date, { weekday: "short" })}</strong>
                        <span>{dateLabel(date, { month: "short", day: "numeric" })}</span>
                      </div>

                      {dayEvents.length === 0 ? (
                        <p style={{ color: "var(--muted)", fontSize: "11px", margin: "10px 0" }}>
                          No {scheduleContentMode === "commitments" ? "commitments" : "sessions"}
                        </p>
                      ) : (
                        <>
                          {dayEvents.map((event) => {
                            if (event.kind === "commitment") {
                              const commitment = event.commitment;
                              return (
                                <div key={commitment.id} className="schedule-session-item commitment-session" style={{ borderColor: commitment.color }}>
                                  <div className="schedule-session-event-head">
                                    <span className="schedule-session-time-range">{formatTime12(commitment.startTime)} – {formatTime12(commitment.endTime)}</span>
                                    <span className="schedule-kind-label commitment-label">COMMITMENT</span>
                                  </div>
                                  <strong>{commitment.icon} {commitment.title}</strong>
                                  {commitment.notes && <p>{commitment.notes}</p>}
                                </div>
                              );
                            }
                            const task = event.task;
                            const goalInfo = planner.goals.find((goal) => goal.id === task.goalId);
                            return (
                              <div key={task.id} className={`schedule-session-item ${task.status === "COMPLETED" ? "done" : ""}`} style={{ borderColor: goalInfo?.color || "var(--green)" }}>
                                <div className="schedule-session-event-head">
                                  <span className="schedule-session-time-range">{formatTime12(task.start)} – {formatTime12(task.end)}</span>
                                  <span className="schedule-kind-label goal-label">GOAL</span>
                                </div>
                                <span className="schedule-session-goal">{goalInfo?.emoji} {goalInfo?.title}</span>
                                <p>{task.title}</p>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              // Single Day View inside Schedule
              <div className="today-sessions-list">
                {scheduleTodayEvents.map((event) => {
                  if (event.kind === "commitment") {
                    const commitment = event.commitment;
                    return (
                      <article key={commitment.id} className="today-session-card commitment-session">
                        <div className="session-content">
                          <div className="session-goal-header">
                            <span className="session-time-badge">{formatTime12(commitment.startTime)} – {formatTime12(commitment.endTime)}</span>
                            <span className="schedule-kind-label commitment-label">COMMITMENT</span>
                          </div>
                          <h3>{commitment.icon} {commitment.title}</h3>
                          <span className="session-sub-info">{commitment.daysOfWeek.join(", ")}{commitment.notes ? " · " + commitment.notes : ""}</span>
                        </div>
                      </article>
                    );
                  }
                  const task = event.task;
                  const goalInfo = planner.goals.find((goal) => goal.id === task.goalId);
                  return (
                    <article key={task.id} className="today-session-card">
                      <div className="session-content">
                        <div className="session-goal-header">
                          <span className="session-time-badge">{formatTime12(task.start)} – {formatTime12(task.end)}</span>
                          <span className="schedule-kind-label goal-label">GOAL</span>
                        </div>
                        <h3>{task.title}</h3>
                        <span className="session-sub-info">{goalInfo?.emoji} {goalInfo?.title} · {task.duration} min</span>
                      </div>
                      <button className={task.status === "COMPLETED" ? "btn-completed-toggle" : "btn-start-session"} onClick={() => advanceTask(task.id)}>
                        {task.status === "COMPLETED" ? <Check size={14} /> : task.status === "TODO" ? <Play size={14} /> : <Check size={14} />}
                        {task.status === "COMPLETED" ? "Completed" : task.status === "TODO" ? "Start session" : "Mark complete"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            5. PROGRESS VIEW
            ══════════════════════════════════════════════════════════════════ */}
        {activeView === "Progress" && !selectedGoalId && (
          <div className="view-section">
            <div className="stats-grid">
              <div>
                <span>Active Goals</span>
                <strong>{planner.goals.filter((g) => g.status !== "PAUSED").length}</strong>
                <small>across your planner</small>
              </div>
              <div>
                <span>Completed Sessions</span>
                <strong>
                  {planner.tasks.filter((t) => t.status === "COMPLETED").length}
                </strong>
                <small>sessions finished</small>
              </div>
              <div>
                <span>Time Invested</span>
                <strong>
                  {formatMinutes(
                    planner.tasks
                      .filter((t) => t.status === "COMPLETED")
                      .reduce((sum, t) => sum + t.duration, 0),
                  )}
                </strong>
                <small>total focus time</small>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            MODAL: DELETE GOAL CONFIRMATION
            ══════════════════════════════════════════════════════════════════ */}
        {goalToDelete && (
          <div className="modal-backdrop" onClick={() => setGoalToDelete(null)}>
            <div className="modal-window" role="alertdialog" aria-modal="true" aria-labelledby="delete-goal-title" onClick={(e) => e.stopPropagation()}>
              <h3 id="delete-goal-title">Delete this goal?</h3>
              <p>
                This will remove this goal and its generated sessions. Your commitments will not be affected.
              </p>
              <div className="modal-actions-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setGoalToDelete(null)}
                >
                  Cancel
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={confirmDeleteGoal}
                >
                  <Trash2 size={14} /> Delete Goal
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            MODAL: EDIT GOAL
            ══════════════════════════════════════════════════════════════════ */}
        {goalToEdit && (
          <div className="modal-backdrop" onClick={() => setGoalToEdit(null)}>
            <div className="modal-window" onClick={(e) => e.stopPropagation()}>
              <h3>Edit Goal</h3>
              <div className="flow-field" style={{ marginBottom: "14px" }}>
                <label className="flow-label">Goal Title</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Goal Title"
                  required
                />
              </div>

              <div className="flow-field" style={{ marginBottom: "20px" }}>
                <label className="flow-label">Priority</label>
                <div className="chip-group">
                  {(["HIGH", "MEDIUM", "LOW"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`chip-button ${editPriority === p ? "selected" : ""}`}
                      onClick={() => setEditPriority(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="modal-actions-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setGoalToEdit(null)}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={!editTitle.trim()}
                  onClick={handleSaveEdit}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {showCommitmentForm && (
          <div className="modal-backdrop" onClick={() => setShowCommitmentForm(false)}>
            <div className="modal-window" role="dialog" aria-modal="true" aria-labelledby="add-commitment-title" onClick={(event) => event.stopPropagation()}>
              <div className="section-head">
                <h3 id="add-commitment-title">Add Commitment</h3>
                <button className="text-button" aria-label="Close commitment form" onClick={() => setShowCommitmentForm(false)}><X size={18} /></button>
              </div>
              <div className="flow-field">
                <label className="flow-label" htmlFor="commitment-title">Title</label>
                <input id="commitment-title" value={commitmentTitle} onChange={(event) => setCommitmentTitle(event.target.value)} placeholder="Full-time Job" autoFocus />
              </div>
              <div className="flow-field">
                <label className="flow-label" htmlFor="commitment-type">Type</label>
                <select id="commitment-type" value={commitmentType} onChange={(event) => setCommitmentType(event.target.value as CommitmentItem["type"])}>
                  {COMMITMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.icon} {type.label}</option>)}
                </select>
              </div>
              <div className="flow-field">
                <label className="flow-label">Days</label>
                <div className="chip-group">
                  {ALL_DAYS.map((day) => <button key={day} type="button" className={`chip-button day-chip ${commitmentDays.includes(day) ? "selected" : ""}`} onClick={() => toggleCommitmentDay(day)}>{day.slice(0, 3)}</button>)}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div className="flow-field">
                  <label className="flow-label" htmlFor="commitment-start">Start time</label>
                  <input id="commitment-start" type="time" value={commitmentStartTime} onChange={(event) => setCommitmentStartTime(event.target.value)} />
                </div>
                <div className="flow-field">
                  <label className="flow-label" htmlFor="commitment-end">End time</label>
                  <input id="commitment-end" type="time" value={commitmentEndTime} onChange={(event) => setCommitmentEndTime(event.target.value)} />
                </div>
              </div>
              <div className="flow-field">
                <label className="flow-label" htmlFor="commitment-notes">Notes (optional)</label>
                <textarea id="commitment-notes" rows={3} value={commitmentNotes} onChange={(event) => setCommitmentNotes(event.target.value)} placeholder="Location, details, or recurrence notes" />
              </div>
              <div className="modal-actions-row">
                <button className="secondary-button" onClick={() => setShowCommitmentForm(false)}>Cancel</button>
                <button className="primary-button" disabled={!commitmentTitle.trim() || commitmentDays.length === 0} onClick={handleSaveCommitment}><Plus size={15} /> Save Commitment</button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            GOAL CREATION FLOW (STREAMLINED AI ONBOARDING)
            ══════════════════════════════════════════════════════════════════ */}
        {showGoalForm && (
          <section ref={goalEditor} className="goal-editor" aria-labelledby="flow-title">
            <div className="section-head">
              <h2 id="flow-title">
                {flowStep === "goal" && "What's your goal?"}
                {flowStep === "availability" && "When can you realistically work on this?"}
                {flowStep === "loading" && "Creating your personalized plan"}
                {flowStep === "preview" && "Your Plan"}
              </h2>
              <button
                className="text-button"
                aria-label="Close form"
                onClick={() => setShowGoalForm(false)}
              >
                <X size={18} />
              </button>
            </div>

            {flowStep === "goal" && (
              <div className="flow-container">
                <div className="flow-header">
                  <span className="flow-step-badge">Step 1 of 2</span>
                  <p>
                    Tell us what you want to accomplish. You can describe it naturally — the AI
                    will figure out the details.
                  </p>
                </div>

                <div className="flow-field">
                  <label htmlFor="goal-input" className="flow-label">
                    Goal Description
                  </label>
                  <textarea
                    id="goal-input"
                    className="goal-textarea"
                    autoFocus
                    required
                    rows={4}
                    value={goalText}
                    onChange={(e) => setGoalText(e.target.value)}
                    placeholder="I want to learn Python DSA and become comfortable solving easy and medium LeetCode problems in 30 days."
                  />
                  <span className="flow-hint">
                    Feel free to include your timeline, target outcome, or context.
                  </span>
                </div>

                <div className="flow-field">
                  <label htmlFor="goal-deadline" className="flow-label">
                    Target Timeframe (Optional)
                  </label>
                  <input
                    id="goal-deadline"
                    value={goalDeadline}
                    onChange={(e) => setGoalDeadline(e.target.value)}
                    placeholder="e.g. 30 days, 2 months, by end of year"
                  />
                </div>

                {commitmentClarification && (
                  <div className="intent-clarification" role="status">
                    <strong>What are you trying to accomplish?</strong>
                    <p>This sounds like existing work or study commitments. Add those to your schedule, or continue if you have a specific learning or project goal.</p>
                    <div className="intent-clarification-actions">
                      <button className="primary-button" type="button" onClick={() => { setCommitmentClarification(false); setFlowStep("availability"); }}>
                        Create a learning/project goal
                      </button>
                      <button className="secondary-button" type="button" onClick={openNewCommitment}>
                        Add existing commitments
                      </button>
                    </div>
                  </div>
                )}

                <div className="flow-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setShowGoalForm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!goalText.trim()}
                    onClick={continueGoalSetup}
                  >
                    Set availability <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}

            {flowStep === "availability" && (
              <div className="flow-container">
                <div className="flow-header">
                  <span className="flow-step-badge">Step 2 of 2</span>
                  <p>We&apos;ll build the schedule around your actual routine.</p>
                </div>

                <div className="flow-field">
                  <label className="flow-label">1. Hours available per day</label>
                  <div className="chip-group">
                    {HOURS_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={`chip-button ${hoursPerDay === opt ? "selected" : ""}`}
                        onClick={() => setHoursPerDay(opt)}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flow-field">
                  <label className="flow-label">2. Days available</label>
                  <span className="flow-hint">Select the days you can commit to sessions:</span>
                  <div className="chip-group">
                    {ALL_DAYS.map((day) => {
                      const isSelected = selectedDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`chip-button day-chip ${isSelected ? "selected" : ""}`}
                          onClick={() => toggleDay(day)}
                        >
                          {day.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flow-field">
                  <label className="flow-label">3. Preferred time of day</label>
                  <div className="chip-group">
                    {TIME_OF_DAY_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={`chip-button ${preferredTime === opt ? "selected" : ""}`}
                        onClick={() => setPreferredTime(opt)}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flow-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setFlowStep("goal")}
                  >
                    <ArrowLeft size={14} /> Back to goal
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => generatePlanCall()}
                  >
                    Build my plan <Wand2 size={15} />
                  </button>
                </div>
              </div>
            )}

            {flowStep === "loading" && (
              <div className="flow-container">
                {aiError ? (
                  <div className="flow-field">
                    <div className="ai-error-box" role="alert">
                      <span>{aiError}</span>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => generatePlanCall()}
                      >
                        <RefreshCw size={14} /> Try Again
                      </button>
                    </div>
                    <div className="flow-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setFlowStep("availability")}
                      >
                        <ArrowLeft size={14} /> Back to availability
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="loading-box">
                    <div className="spinner" />
                    <p className="loading-status-text">{LOADING_MESSAGES[loadingMsgIndex]}</p>
                    <span className="loading-subtext">
                      Analyzing your goal, milestones, and available time slots...
                    </span>
                  </div>
                )}
              </div>
            )}

            {flowStep === "preview" && generatedPlan && (
              <div className="plan-preview">
                <div className="plan-hero">
                  <span className="plan-hero-eyebrow">Personalized AI Plan</span>
                  <h3>{generatedPlan.goal || goalText}</h3>
                  {generatedPlan.target && (
                    <p className="plan-hero-target">
                      <strong>Target:</strong> {generatedPlan.target}
                    </p>
                  )}
                  <div className="plan-meta-pills">
                    {generatedPlan.durationDays && (
                      <span className="meta-pill">
                        ⏱ {generatedPlan.durationDays} Days Duration
                      </span>
                    )}
                    <span className="meta-pill">⌛ {hoursPerDay} daily</span>
                    <span className="meta-pill">
                      📅 {selectedDays.length === 7 ? "Every day" : `${selectedDays.length} days/week`}
                    </span>
                    <span className="meta-pill">🕒 {preferredTime}</span>
                  </div>
                </div>

                {generatedPlan.assumptions && generatedPlan.assumptions.length > 0 && (
                  <div className="plan-block">
                    <div className="plan-block-title">Assumptions & Starting Context</div>
                    <ul className="plan-assumptions-list">
                      {generatedPlan.assumptions.map((assump, idx) => (
                        <li key={idx}>{assump}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {generatedPlan.strategy && (
                  <div className="plan-block">
                    <div className="plan-block-title">Overall Strategy</div>
                    <p className="plan-strategy-text">{generatedPlan.strategy}</p>
                  </div>
                )}

                {generatedPlan.milestones && generatedPlan.milestones.length > 0 && (
                  <div className="plan-block">
                    <div className="plan-block-title">
                      Milestones ({generatedPlan.milestones.length})
                    </div>
                    <div className="milestones-accordion">
                      {generatedPlan.milestones.map((m, idx) => (
                        <div key={idx} className="milestone-card">
                          <div className="milestone-head">
                            <div className="milestone-title-wrap">
                              <span className="milestone-badge">M{m.order || idx + 1}</span>
                              <h4>{m.title}</h4>
                            </div>
                            <span className="heading-note">
                              {formatMinutes(m.estimatedMinutes || 120)}
                            </span>
                          </div>
                          {m.description && (
                            <p className="heading-note" style={{ marginTop: "4px" }}>
                              {m.description}
                            </p>
                          )}
                          <div className="milestone-tasks-list">
                            {m.tasks.map((task, tIdx) => (
                              <div key={tIdx} className="plan-task-row">
                                <span>{task.title}</span>
                                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                  <span className={`priority-tag ${task.priority || "MEDIUM"}`}>
                                    {task.priority || "MEDIUM"}
                                  </span>
                                  <small>{explicitSessionDuration(goalText) ?? task.estimatedMinutes}m</small>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {showModifyInput && (
                  <form
                    className="modify-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (modifyPrompt.trim()) {
                        generatePlanCall({ modificationPrompt: modifyPrompt.trim() });
                      }
                    }}
                  >
                    <input
                      className="modify-input"
                      autoFocus
                      placeholder="e.g. Focus more on LeetCode Mediums..."
                      value={modifyPrompt}
                      onChange={(e) => setModifyPrompt(e.target.value)}
                    />
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={!modifyPrompt.trim() || aiBusy}
                    >
                      Apply
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setShowModifyInput(false)}
                    >
                      Cancel
                    </button>
                  </form>
                )}

                {showDeadlineInput && (
                  <form
                    className="modify-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (tempDeadline.trim()) {
                        setGoalDeadline(tempDeadline.trim());
                        generatePlanCall({ deadline: tempDeadline.trim() });
                      }
                    }}
                  >
                    <input
                      className="modify-input"
                      autoFocus
                      placeholder="New duration (e.g. 14 days, 60 days)"
                      value={tempDeadline}
                      onChange={(e) => setTempDeadline(e.target.value)}
                    />
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={!tempDeadline.trim() || aiBusy}
                    >
                      Update
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setShowDeadlineInput(false)}
                    >
                      Cancel
                    </button>
                  </form>
                )}

                <div className="plan-controls-bar">
                  <button className="primary-button" type="button" onClick={handleStartPlan}>
                    <Check size={16} /> Start Plan
                  </button>

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setFlowStep("availability")}
                  >
                    <Sliders size={14} /> Edit Availability
                  </button>

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setShowDeadlineInput(!showDeadlineInput);
                      setShowModifyInput(false);
                    }}
                  >
                    <CalendarDays size={14} /> Change Deadline
                  </button>

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      const nextDiff =
                        difficulty === "beginner"
                          ? "moderate"
                          : difficulty === "moderate"
                            ? "intensive"
                            : "beginner";
                      setDifficulty(nextDiff);
                      generatePlanCall({ difficulty: nextDiff });
                    }}
                  >
                    <Sparkles size={14} /> Difficulty: {difficulty}
                  </button>

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setShowModifyInput(!showModifyInput);
                      setShowDeadlineInput(false);
                    }}
                  >
                    <Wand2 size={14} /> Ask AI to Modify Plan
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            RESCHEDULE TASK DIALOG
            ══════════════════════════════════════════════════════════════════ */}
        {skipTask && (
          <section
            ref={skipEditor}
            tabIndex={-1}
            className="goal-editor"
            aria-labelledby="skip-title"
          >
            <div className="section-head">
              <h2 id="skip-title">Reschedule {skipTask.title}</h2>
              <button
                className="text-button"
                aria-label="Cancel rescheduling"
                onClick={() => setSkipTask(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p>What got in the way? We&apos;ll look for free time over the next 14 days.</p>
            <div className="reason-grid">
              {["Busy", "Too tired", "Took longer", "Unexpected event", "Not interested", "Other"].map(
                (reason) => (
                  <button key={reason} onClick={() => skipWithReason(reason)}>
                    {reason}
                  </button>
                ),
              )}
            </div>
          </section>
        )}
      </section>

      <nav className="mobile-bottom-nav" aria-label="Main navigation">
        {[
          { label: "Today", icon: CalendarCheck },
          { label: "Goals", icon: Target },
          { label: "Schedule", icon: CalendarDays },
        ].map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={`mobile-nav-item ${activeView === label && !selectedGoalId ? "active" : ""}`}
            aria-current={activeView === label && !selectedGoalId ? "page" : undefined}
            onClick={() => {
              setActiveView(label);
              setSelectedGoalId(null);
            }}
          >
            <Icon size={19} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {toast && (
        <button role="status" className="toast" onClick={() => setToast("")}>
          {toast}
        </button>
      )}
    </main>
  );
}

