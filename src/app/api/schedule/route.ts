import { NextResponse } from "next/server";
import { z } from "zod";
import { demoTasks, localDate, weekDates } from "@/lib/scheduler";

const scheduleQuery = z.object({
  date: z.string().date().optional(),
  view: z.enum(["today", "week"]).default("today"),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = scheduleQuery.safeParse({
    date: url.searchParams.get("date") ?? undefined,
    view: url.searchParams.get("view") ?? "today",
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Use an ISO date and a today or week view." }, { status: 400 });
  }

  const { view } = parsed.data;
  const date = parsed.data.date ?? localDate();
  const dates = view === "week" ? weekDates(date) : [date];
  const tasks = demoTasks.filter((task) => dates.includes(task.date));
  return NextResponse.json({ date, view, tasks, source: "example", constraints: { work: "Mon-Fri 10:30-19:30", sleep: "23:30-07:30", maxDailyGoalMinutes: 120 } });
}
