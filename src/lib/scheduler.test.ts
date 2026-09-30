import { describe, expect, it } from "vitest";
import { activeGoalTasks, scheduledGoalTasks, scheduleEventsForDay, canScheduleTask, commitmentWindowsForDate, completionPercent, explicitDeadlineDays, explicitSessionDuration, overlapsFixedWindow, redistributeTask, scheduleGoalTasks, scheduleGoalTasksPartial, demoTasks, weekDates, formatMinutes } from "./scheduler";
import { addGoalWithTasks, deleteGoal, initialPlanner, pauseGoal } from "./planner-store";
import type { PlannerTask } from "./scheduler";

describe("scheduler regressions", () => {
  it("rejects invalid durations and workload inputs", () => {
    for (const duration of [-30, 0, NaN, Infinity]) expect(canScheduleTask(20, duration, 120, 0)).toBe(false);
    expect(canScheduleTask(20, 30, 120, -30)).toBe(false);
  });
  it("preserves all minutes with one available day", () => {
    const parts = redistributeTask(demoTasks[1], ["2026-10-01"]);
    expect(parts.reduce((n, task) => n + task.duration, 0)).toBe(75);
  });
  it("keeps uneven session durations intact and matches clock times", () => {
    const parts = redistributeTask({ ...demoTasks[1], duration: 76 }, ["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(parts.reduce((n, task) => n + task.duration, 0)).toBe(76);
    expect(parts.map((task) => task.duration)).toEqual([76]);
    for (const task of parts) {
      const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      expect(minutes(task.end) - minutes(task.start)).toBe(task.duration);
    }
  });
  it("does not silently discard work when there are no dates", () => {
    expect(() => redistributeTask(demoTasks[1], [])).toThrow();
  });
  it("avoids existing sessions and refuses insufficient capacity", () => {
    const busy = { ...demoTasks[1], id: "other-session", date: "2026-10-01", start: "07:30", end: "09:30", duration: 120 };
    expect(() => redistributeTask(demoTasks[1], ["2026-10-01"], [busy])).toThrow();
  });
  it("places work after an existing morning session without overlap", () => {
    const busy = { ...demoTasks[1], id: "other", date: "2026-10-01", start: "07:30", end: "08:15", duration: 45 };
    const parts = redistributeTask(demoTasks[1], ["2026-10-01"], [busy]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ start: "08:15", end: "09:30", duration: 75 });
  });
  it("rejects invalid or nonfuture dates without dropping work", () => {
    expect(() => redistributeTask(demoTasks[1], ["2026-09-30", "2026-09-31", "invalid"])).toThrow();
  });
  it("handles month and year boundaries", () => {
    expect(weekDates("2026-09-30")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(weekDates("2027-01-01")[0]).toBe("2026-12-28");
  });
  it("formats exact hours and remaining minutes", () => {
    expect(formatMinutes(420)).toBe("7h 0m");
    expect(formatMinutes(435)).toBe("7h 15m");
  });
});

describe("deterministic scheduler constraints", () => {
  const planned = (title: string, duration: number) => [{ title, category: title, duration, priority: "MEDIUM" as const, milestone: title }];
  const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  it("recognizes an explicit requested session duration without changing task estimates otherwise", () => {
    expect(explicitSessionDuration("Build a fitness routine with 45 minutes per session")).toBe(45);
    expect(explicitSessionDuration("I have 45 minutes available per day")).toBeUndefined();
  });

  it("limits scheduled sessions to an explicit duration or calendar deadline", () => {
    expect(explicitDeadlineDays("30 days", "2026-10-05")).toBe(30);
    expect(explicitDeadlineDays("2026-10-08", "2026-10-05")).toBe(4);
    expect(explicitDeadlineDays("sometime soon", "2026-10-05")).toBeUndefined();
  });

  it("keeps generated tasks owned by their goal when multiple goals coexist", () => {
    const start = "2026-10-05";
    const fitnessGoalId = "fitness";
    const mernGoalId = "mern";
    const fitness = scheduleGoalTasks(planned("Squats", 45), fitnessGoalId, start, "Evening", weekDays);
    expect(fitness.every((task) => task.goalId === fitnessGoalId)).toBe(true);

    const withFitness = addGoalWithTasks(initialPlanner(start), "Fitness", fitnessGoalId, fitness);
    const mern = scheduleGoalTasks(planned("Build a route", 45), mernGoalId, start, "Evening", weekDays, withFitness.tasks);
    expect(mern.every((task) => task.goalId === mernGoalId)).toBe(true);
    expect(mern.some((task) => fitness.some((fitnessTask) => fitnessTask.id === task.id))).toBe(false);

    const withMern = addGoalWithTasks(withFitness, "MERN", mernGoalId, mern);
    expect(withMern.tasks.filter((task) => task.goalId === fitnessGoalId)).toEqual(fitness);
    expect(withMern.tasks.filter((task) => task.goalId === mernGoalId)).toEqual(mern);
    const repeatedFitness = scheduleGoalTasks(planned("Next workout", 45), fitnessGoalId, start, "Evening", weekDays, withMern.tasks);
    expect(repeatedFitness.every((task) => !withMern.tasks.some((existing) => existing.id === task.id))).toBe(true);
    const combined = [...fitness, ...mern].filter((task, index, all) => all.findIndex((candidate) => candidate.id === task.id) === index);
    for (let left = 0; left < combined.length; left += 1) {
      for (let right = left + 1; right < combined.length; right += 1) {
        if (combined[left].date !== combined[right].date) continue;
        expect(combined[left].end <= combined[right].start || combined[right].end <= combined[left].start).toBe(true);
      }
    }
    const afterFitnessDelete = deleteGoal(withMern, fitnessGoalId);
    expect(afterFitnessDelete.tasks.filter((task) => task.goalId === mernGoalId)).toEqual(mern);
  });

  it("appends A, B, and C sessions without replacement or duplication and isolates deletion", () => {
    const start = "2026-10-05";
    const days = weekDays;
    let state = initialPlanner(start);
    const addScheduledGoal = (title: string, id: string) => {
      const result = scheduleGoalTasksPartial(planned(`${title} session`, 60).concat(planned(`${title} follow-up`, 60)), id, start, "Evening", days, state.tasks, state.commitments, 120, 14);
      state = addGoalWithTasks(state, title, id, result.scheduledTasks);
      return result.scheduledTasks;
    };
    const tasksA = addScheduledGoal("DSA", "goal-a");
    const tasksB = addScheduledGoal("MERN", "goal-b");
    const tasksC = addScheduledGoal("ML", "goal-c");
    expect(state.tasks.filter((task) => task.goalId === "goal-a")).toEqual(tasksA);
    expect(state.tasks.filter((task) => task.goalId === "goal-b")).toEqual(tasksB);
    expect(state.tasks.filter((task) => task.goalId === "goal-c")).toEqual(tasksC);
    expect(new Set(state.tasks.map((task) => task.id)).size).toBe(state.tasks.length);
    for (const [goalId, tasks] of [["goal-a", tasksA], ["goal-b", tasksB], ["goal-c", tasksC]] as const) {
      expect(tasks.every((task) => task.goalId === goalId)).toBe(true);
    }
    const withoutB = deleteGoal(state, "goal-b");
    expect(withoutB.tasks.filter((task) => task.goalId === "goal-a")).toEqual(tasksA);
    expect(withoutB.tasks.filter((task) => task.goalId === "goal-c")).toEqual(tasksC);
    expect(withoutB.tasks.some((task) => task.goalId === "goal-b")).toBe(false);
  });

  it("considers all existing tasks occupied and leaves prior goals untouched when the new goal cannot fit", () => {
    const start = "2026-10-05";
    const existing = scheduleGoalTasks(planned("A session", 60), "goal-a", start, "Evening", ["Monday"]);
    const before = structuredClone(existing);
    const result = scheduleGoalTasksPartial(planned("B session", 180), "goal-b", start, "Evening", ["Monday"], existing, [], 120, 1);
    expect(result.scheduledTasks).toEqual([]);
    expect(result.unscheduledTasks.map((task) => task.goalId)).toEqual(["goal-b"]);
    expect(existing).toEqual(before);
  });

  it("avoids a prior goal's exact occupied Monday 7 PM hour for a second goal", () => {
    const existing: PlannerTask[] = [{ ...demoTasks[1], id: "a-monday", goalId: "goal-a", date: "2026-10-05", start: "19:00", end: "20:00", duration: 60 }];
    const [newTask] = scheduleGoalTasks(planned("B session", 60), "goal-b", "2026-10-05", "Evening", ["Monday"], existing, [], 120, 1);
    expect(newTask.date).toBe("2026-10-05");
    expect(newTask.start).not.toBe("19:00");
    expect(newTask.end <= "19:00" || newTask.start >= "20:00").toBe(true);
  });

  it("schedules a second goal after the first goal ends and ignores unscheduled placeholders", () => {
    const firstGoal = scheduleGoalTasksPartial(
      Array.from({ length: 5 }, (_, index) => ({ ...planned(`DSA ${index + 1}`, 90)[0], category: "DSA" })),
      "dsa", "2026-09-30", "Evening", weekDays, [], [], 120, 14,
    ).scheduledTasks;
    expect(firstGoal.map((task) => task.date)).toEqual([
      "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    const unscheduled = ["Mongoose ODM", "Integrate MongoDB with Express", "React basics"].map((title, index): PlannerTask => ({
      ...demoTasks[0], id: `pending-${index}`, goalId: "mern", title, date: "2026-09-30", start: "00:00", end: "00:00", duration: 90, scheduleStatus: "UNSCHEDULED",
    }));
    const existing = [...firstGoal, ...unscheduled];
    const beforeA = structuredClone(firstGoal);
    const secondGoal = scheduleGoalTasksPartial(
      planned("Mongoose ODM", 90).concat(planned("React basics", 90)),
      "mern", "2026-09-30", "Evening", weekDays, existing, [], 120, 30,
    );
    expect(secondGoal.scheduledTasks.map((task) => task.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(secondGoal.scheduledTasks.every((task) => task.goalId === "mern")).toBe(true);
    expect(firstGoal).toEqual(beforeA);
    for (const a of firstGoal) for (const b of secondGoal.scheduledTasks) {
      if (a.date !== b.date) continue;
      expect(a.end <= b.start || b.end <= a.start).toBe(true);
    }
  });

  it("keeps second-goal work unscheduled when existing commitments leave no valid slot", () => {
    const firstGoal = scheduleGoalTasks(planned("DSA", 90), "dsa", "2026-10-05", "Evening", ["Monday"]);
    const commitment = { daysOfWeek: ["Monday"], startTime: "07:30", endTime: "23:30" };
    const secondGoal = scheduleGoalTasksPartial(planned("MERN", 90), "mern", "2026-10-05", "Evening", ["Monday"], firstGoal, [commitment], 120, 1);
    expect(secondGoal.scheduledTasks).toEqual([]);
    expect(secondGoal.unscheduledTasks).toEqual([{ ...planned("MERN", 90)[0], goalId: "mern" }]);
    expect(firstGoal).toHaveLength(1);
  });

  it("does not count an unscheduled placeholder toward a day's occupied workload", () => {
    const placeholder: PlannerTask = { ...demoTasks[0], id: "pending-placeholder", goalId: "mern", title: "Pending MERN", date: "2026-10-05", start: "00:00", end: "00:00", duration: 120, scheduleStatus: "UNSCHEDULED" };
    const result = scheduleGoalTasksPartial(planned("MERN session", 120), "mern", "2026-10-05", "Evening", ["Monday"], [placeholder], [], 120, 1);
    expect(result.scheduledTasks).toHaveLength(1);
    expect(result.scheduledTasks[0].date).toBe("2026-10-05");
    expect(result.candidateDiagnostics[0]).toMatchObject({ date: "2026-10-05", requestedDuration: 120, candidateSlot: expect.any(String), result: "ACCEPTED" });
    expect(result.candidateDiagnostics[0].existingGoalTaskBlocks).toEqual([]);
  });

  it("explains selected-day and commitment rejections with concrete candidate diagnostics", () => {
    const commitment = { daysOfWeek: ["Monday"], startTime: "07:30", endTime: "23:30" };
    const result = scheduleGoalTasksPartial(planned("Blocked session", 90), "mern", "2026-10-05", "Evening", ["Tuesday"], [], [commitment], 120, 2);
    expect(result.candidateDiagnostics[0]).toMatchObject({ date: "2026-10-05", result: "REJECTED", rejectionReason: "unavailable selected day" });
    expect(result.candidateDiagnostics[1]).toMatchObject({ date: "2026-10-06", result: "ACCEPTED", candidateSlot: expect.any(String) });
    const blocked = scheduleGoalTasksPartial(planned("Blocked session", 90), "mern", "2026-10-05", "Evening", ["Monday"], [], [commitment], 120, 1);
    expect(blocked.candidateDiagnostics[0]).toMatchObject({ result: "REJECTED", rejectionReason: expect.stringContaining("commitment conflict"), commitmentBlocks: ["07:30–23:30"] });
    expect(blocked.searchWindow).toEqual({ startDate: "2026-10-05", lastDate: "2026-10-05", maxDaysToSchedule: 1 });
  });

  it("rejects mismatched task ownership before adding tasks to a goal", () => {
    const state = initialPlanner("2026-10-05");
    const otherTask: PlannerTask = { ...demoTasks[0], id: "wrong-owner", goalId: "other-goal" };
    const added = addGoalWithTasks(state, "Fitness", "fitness", [otherTask]);
    expect(added.tasks.some((task) => task.id === "wrong-owner")).toBe(false);
    expect(added.goals.some((goal) => goal.id === "fitness")).toBe(true);
  });

  it("preserves requested session duration and distributes on selected weekdays around commitments", () => {
    const commitment = {
      id: "work",
      title: "Work",
      type: "work" as const,
      daysOfWeek: weekDays.slice(0, 5),
      startTime: "10:30",
      endTime: "19:30",
      notes: "",
      color: "#2563eb",
      icon: "briefcase",
      status: "ACTIVE" as const,
    };
    const tasks = scheduleGoalTasks(
      planned("Session", 45).concat(planned("Next session", 45)),
      "fitness",
      "2026-10-05",
      "Evening",
      weekDays,
      [],
      [commitment],
      120,
    );
    expect(tasks.map((task) => task.duration)).toEqual([45, 45]);
    expect(tasks.map((task) => task.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(tasks.every((task) => task.goalId === "fitness")).toBe(true);
    for (const task of tasks) {
      const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(`${task.date}T12:00:00`));
      if (!commitment.daysOfWeek.includes(dayName)) continue;
      expect(task.end <= commitment.startTime || task.start >= commitment.endTime).toBe(true);
    }
  });

  it("reports insufficient daily availability instead of shortening a session", () => {
    expect(() => scheduleGoalTasks(
      planned("Long session", 180),
      "fitness",
      "2026-10-05",
      "Evening",
      ["Monday", "Tuesday"],
      [],
      [],
      120,
      2,
    )).toThrow("without shortening it");
  });

  it("schedules every feasible task and keeps an impossible task intact with its goal", () => {
    const result = scheduleGoalTasksPartial(
      planned("Mini-project", 150).concat(planned("Review", 45), planned("Practice", 60)),
      "dsa-goal", "2026-10-05", "Evening", ["Monday", "Tuesday", "Wednesday"], [], [], 120, 3,
    );
    expect(result.scheduledTasks.map((task) => task.title)).toEqual(["Review", "Practice"]);
    expect(result.scheduledTasks.every((task) => task.goalId === "dsa-goal")).toBe(true);
    expect(result.unscheduledTasks).toEqual([{ ...planned("Mini-project", 150)[0], goalId: "dsa-goal" }]);
  });

  it("marks persisted unscheduled tasks as unavailable to active schedule views", () => {
    const stored = { ...demoTasks[0], id: "unscheduled", goalId: "dsa", scheduleStatus: "UNSCHEDULED" as const };
    expect(activeGoalTasks([stored], [{ id: "dsa", status: "ACTIVE" }])).toEqual([]);
  });

  it("moves an unchanged session to another selected day when its preferred slot is blocked", () => {
    const lateCommitment = {
      daysOfWeek: ["Monday"],
      startTime: "07:30",
      endTime: "23:30",
    };
    const [task] = scheduleGoalTasks(planned("Session", 45), "fitness", "2026-10-05", "Evening", ["Monday", "Tuesday"], [], [lateCommitment]);
    expect(task.date).toBe("2026-10-06");
    expect(task.duration).toBe(45);
  });

  it("shows scheduled tasks from all goals and retains paused-goal history", () => {
    const state = initialPlanner("2026-10-05");
    const withFitness = addGoalWithTasks(state, "Fitness", "fitness", [
      { ...demoTasks[0], id: "fitness-task", date: "2026-10-05", goalId: "fitness" },
    ]);
    const withMern = addGoalWithTasks(withFitness, "MERN", "mern", [
      { ...demoTasks[0], id: "mern-task", date: "2026-10-05", goalId: "mern" },
    ]);
    const visible = activeGoalTasks(withMern.tasks, withMern.goals);
    expect(visible.map((task) => task.id)).toContain("fitness-task");
    expect(visible.map((task) => task.id)).toContain("mern-task");
    const paused = pauseGoal(withMern, "fitness");
    expect(activeGoalTasks(paused.tasks, paused.goals).map((task) => task.id)).toContain("fitness-task");
    expect(scheduledGoalTasks(paused.tasks, paused.goals).map((task) => task.id)).toContain("fitness-task");
    expect(activeGoalTasks(paused.tasks, paused.goals).map((task) => task.id)).toContain("mern-task");
  });

  it("builds Schedule goals events for all goals on the same date independent of activeGoalId", () => {
    const dsa: PlannerTask = { ...demoTasks[0], id: "dsa-same-day", goalId: "dsa", title: "Custom Set Implementation", date: "2026-09-30", start: "00:00", end: "00:45" };
    const mern: PlannerTask = { ...demoTasks[1], id: "mern-same-day", goalId: "mern", title: "Review JavaScript fundamentals", date: "2026-09-30", start: "19:00", end: "20:00" };
    const tasks = [mern, dsa];
    const goals = [{ id: "dsa" }, { id: "mern" }];
    expect(scheduleEventsForDay(tasks, goals, [], "2026-09-30", "goals").map((event) => event.kind === "goal" ? event.task.id : "")).toEqual(["dsa-same-day", "mern-same-day"]);
    expect(scheduleEventsForDay(tasks, goals, [], "2026-09-30", "goals").filter((event) => event.kind === "goal").map((event) => event.task.start)).toContain("00:00");
  });

  it("builds Schedule goals events on each task's actual date", () => {
    const mon: PlannerTask = { ...demoTasks[0], id: "dsa-monday", goalId: "dsa", date: "2026-09-28" };
    const tue: PlannerTask = { ...demoTasks[1], id: "mern-tuesday", goalId: "mern", date: "2026-09-29" };
    expect(scheduleEventsForDay([mon, tue], [{ id: "dsa" }, { id: "mern" }], [], "2026-09-28", "goals").map((event) => event.kind === "goal" ? event.task.id : "")).toEqual(["dsa-monday"]);
    expect(scheduleEventsForDay([mon, tue], [{ id: "dsa" }, { id: "mern" }], [], "2026-09-29", "goals").map((event) => event.kind === "goal" ? event.task.id : "")).toEqual(["mern-tuesday"]);
  });

  it("filters commitments alone and combines commitments with all goal events in time order", () => {
    const taskA: PlannerTask = { ...demoTasks[0], id: "goal-a", goalId: "a", date: "2026-09-30", start: "19:00", end: "20:00" };
    const taskB: PlannerTask = { ...demoTasks[1], id: "goal-b", goalId: "b", date: "2026-09-30", start: "21:00", end: "22:00" };
    const commitment = { id: "work", title: "Work", daysOfWeek: ["Wednesday"], startTime: "20:00", endTime: "20:30" };
    const tasks = [taskA, taskB];
    const goals = [{ id: "a" }, { id: "b" }];
    const commitments = [commitment];
    expect(scheduleEventsForDay(tasks, goals, commitments, "2026-09-30", "commitments").map((event) => event.kind)).toEqual(["commitment"]);
    const combined = scheduleEventsForDay(tasks, goals, commitments, "2026-09-30", "combined");
    expect(combined.map((event) => event.kind === "goal" ? event.task.id : event.commitment.id)).toEqual(["goal-a", "work", "goal-b"]);
    expect(combined).toHaveLength(3);
  });

  it("rejects overlap with sleep and explicit commitments", () => {
    expect(overlapsFixedWindow(10.5, 11.25)).toBe(false);
    expect(overlapsFixedWindow(22.5, 23.25)).toBe(false);
    expect(overlapsFixedWindow(23.25, 24)).toBe(true);
    const workWindows = commitmentWindowsForDate("2026-09-30", [{
      daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      startTime: "10:30",
      endTime: "19:30",
    }]);
    expect(overlapsFixedWindow(10.5, 11.25, workWindows)).toBe(true);
    expect(commitmentWindowsForDate("2026-10-03", [{
      daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      startTime: "10:30",
      endTime: "19:30",
    }])).toEqual([]);
  });

  it("respects daily workload and the end-of-day buffer", () => {
    expect(canScheduleTask(20, 60, 120, 60)).toBe(true);
    expect(canScheduleTask(20, 61, 120, 60)).toBe(false);
    expect(canScheduleTask(23, 60, 180, 0)).toBe(false);
  });

  it("calculates progress from completed tasks", () => {
    expect(completionPercent([{ status: "COMPLETED" }, { status: "TODO" }] as never)).toBe(50);
  });

  it("reschedules a missed task intact on a future date", () => {
    const redistributed = redistributeTask({ id: "missed", title: "Study", category: "Python", duration: 90, date: "2026-09-30", start: "19:45", end: "21:15", status: "SKIPPED", priority: "HIGH", milestone: "Core" }, ["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(redistributed).toHaveLength(1);
    expect(redistributed[0].duration).toBe(90);
    expect(redistributed.reduce((sum, task) => sum + task.duration, 0)).toBe(90);
  });
});
