import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiError } from "@/lib/ai/client";
import { generatePlan } from "@/lib/ai/services";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const plan = await generatePlan(body as Parameters<typeof generatePlan>[0]);
    return NextResponse.json(plan);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid plan request format. Please provide your goal and availability." },
        { status: 400 },
      );
    }
    if (error instanceof AiError && error.code === "NOT_CONFIGURED") {
      return NextResponse.json(
        { error: "AI planning is not configured. Please check environment configuration." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "We couldn't generate your plan right now. Please try again." },
      { status: 503 },
    );
  }
}
