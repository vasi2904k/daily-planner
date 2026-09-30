import { describe, it, expect } from "vitest";
import {
  initialPlanner,
  parsePlanner,
  addGoal,
  addGoalWithTasks,
  addCommitment,
  deleteCommitment,
  deleteGoal,
  pauseCommitment,
  pauseGoal,
  resumeGoal,
  resumeCommitment,
  setTaskStatus,
  updateGoal,
} from "./planner-store";
import type { CommitmentItem } from "./planner-store";

describe("saved planner", () => {
  const workCommitment: CommitmentItem = {
    id: "work",
    title: "Full-time Job",
    type: "work" as const,
    daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    startTime: "10:30",
    endTime: "19:30",
    notes: "",
    color: "#2563eb",
    icon: "💼",
    status: "ACTIVE" as const,
  };

  it("migrates v1 saved data without destroying goals or tasks", () => {
    const legacy = initialPlanner("2026-09-30");
    const restored = parsePlanner(JSON.stringify({ ...legacy, version: 1 }));
    expect(restored.version).toBe(2);
    expect(restored.goals).toHaveLength(1);
    expect(restored.tasks).toHaveLength(7);
    expect(restored.commitments).toEqual([]);
  });

  it("stores, pauses, resumes, and deletes commitments independently", () => {
    const state = addCommitment(initialPlanner("2026-09-30"), workCommitment);
    expect(state.commitments).toHaveLength(1);
    expect(pauseCommitment(state, "work").commitments[0].status).toBe("PAUSED");
    expect(resumeCommitment(pauseCommitment(state, "work"), "work").commitments[0].status).toBe("ACTIVE");
    const afterDelete = deleteCommitment(state, "work");
    expect(afterDelete.goals).toHaveLength(1);
    expect(afterDelete.tasks).toHaveLength(7);
    expect(afterDelete.commitments).toEqual([]);
  });
  it("persists unscheduled task details and keeps the task attached to its goal", () => {
    const state = initialPlanner("2026-09-30");
    const task = { ...state.tasks[0], id: "waiting-task", title: "Mini-project", duration: 150, goalId: "waiting-goal", scheduleStatus: "UNSCHEDULED" as const };
    const withGoal = addGoalWithTasks(state, "DSA", "waiting-goal", [task]);
    const restored = parsePlanner(JSON.stringify(withGoal));
    expect(restored.tasks.find((item) => item.id === "waiting-task")).toMatchObject({ goalId: "waiting-goal", duration: 150, scheduleStatus: "UNSCHEDULED" });
  });

  it("restores task changes and new goals after serialization", () => {
    const state = initialPlanner("2026-09-30");
    state.tasks[1].status = "COMPLETED";
    const updated = addGoal(state, "  Learn Rust  ", "rust");
    const restored = parsePlanner(JSON.stringify(updated));
    expect(restored.tasks[1].status).toBe("COMPLETED");
    expect(restored.goals.find((goal) => goal.id === "rust")?.title).toBe("Learn Rust");
    expect(restored.activeGoalId).toBe("rust");
  });

  it("rejects corrupted saved data and blank goals", () => {
    expect(() => parsePlanner('{"tasks":null}')).toThrow();
    expect(() => addGoal(initialPlanner("2026-09-30"), "  ", "empty")).toThrow();
  });

  it("seeds example tasks relative to first use only", () => {
    const state = initialPlanner("2027-01-01");
    expect(state.tasks[0].date).toBe("2027-01-01");
    expect(parsePlanner(JSON.stringify(state)).tasks[0].date).toBe("2027-01-01");
  });

  it("deletes a goal and removes only its scheduled tasks without affecting others", () => {
    const state = initialPlanner("2026-09-30");
    const withGoalB = addGoalWithTasks(
      state,
      "FastAPI Project",
      "goal-fastapi",
      [
        {
          id: "t-fastapi-1",
          title: "Build endpoint",
          category: "Backend",
          duration: 45,
          date: "2026-09-30",
          start: "19:00",
          end: "19:45",
          status: "TODO",
          priority: "HIGH",
          milestone: "API Structure",
          goalId: "goal-fastapi",
        },
      ],
    );

    expect(withGoalB.goals).toHaveLength(2);
    expect(withGoalB.tasks.some((t) => t.goalId === "goal-fastapi")).toBe(true);

    const withCommitment = addCommitment(withGoalB, workCommitment);
    const afterDelete = deleteGoal(withCommitment, "goal-fastapi");
    expect(afterDelete.goals).toHaveLength(1);
    expect(afterDelete.goals.find((g) => g.id === "goal-fastapi")).toBeUndefined();
    expect(afterDelete.tasks.some((t) => t.goalId === "goal-fastapi")).toBe(false);
    // Goal A's tasks are preserved
    expect(afterDelete.tasks.some((t) => t.goalId === "example")).toBe(true);
    expect(afterDelete.commitments).toEqual([workCommitment]);
    expect(afterDelete.activeGoalId).toBe("example");
  });

  it("pauses and resumes a goal properly", () => {
    const state = initialPlanner("2026-09-30");
    const paused = pauseGoal(state, "example");
    expect(paused.goals[0].status).toBe("PAUSED");

    const resumed = resumeGoal(paused, "example");
    expect(resumed.goals[0].status).toBe("ACTIVE");
  });

  it("updates one session status while preserving every other task", () => {
    const state = initialPlanner("2026-09-30");
    const taskId = state.tasks[1].id;
    const updated = setTaskStatus(state, taskId, "IN_PROGRESS");
    expect(updated.tasks.find((task) => task.id === taskId)?.status).toBe("IN_PROGRESS");
    expect(updated.tasks.find((task) => task.id !== taskId)?.status).toBe("COMPLETED");
  });

  it("updates goal title and priority", () => {
    const state = initialPlanner("2026-09-30");
    const updated = updateGoal(state, "example", {
      title: "Master Python (advanced)",
      priority: "LOW",
    });
    expect(updated.goals[0].title).toBe("Master Python (advanced)");
    expect(updated.goals[0].priority).toBe("LOW");
  });
});
